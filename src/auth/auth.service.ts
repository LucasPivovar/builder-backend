import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { ConfirmPasswordResetDto, LoginDto, RegisterDto, UpdateProfileDto } from './auth.dto';
import { UserEntity } from './user.entity';
import { PasswordResetEntity } from './password-reset.entity';
import { AuthSessionEntity } from './auth-session.entity';
import { EmailVerificationEntity } from './email-verification.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(PasswordResetEntity) private readonly passwordResets: Repository<PasswordResetEntity>,
    @InjectRepository(AuthSessionEntity) private readonly sessions: Repository<AuthSessionEntity>,
    @InjectRepository(EmailVerificationEntity) private readonly emailVerifications: Repository<EmailVerificationEntity>,
    private readonly jwtService: JwtService
  ) {}

  async register(dto: RegisterDto, context: { userAgent?: string; ip?: string } = {}) {
    const email = dto.email.trim().toLowerCase();
    if (await this.users.exists({ where: { email } })) {
      throw new ConflictException('Este e-mail já está cadastrado.');
    }

    const user = this.users.create({
      name: dto.name.trim(),
      lastName: dto.lastName?.trim() || '',
      phone: dto.phone ? dto.phone.replace(/\D/g, '') : '',
      email,
      passwordHash: await hash(dto.password, 12),
      role: await this.shouldBootstrapAdmin(email) ? 'admin' : 'user',
      active: true
    });
    await this.users.save(user);
    const verificationToken = await this.issueEmailVerification(user);
    if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true') {
      const response: any = { emailVerificationRequired: true, email: user.email, message: 'Enviamos um código de confirmação para o seu e-mail.' };
      if (process.env.EXPOSE_EMAIL_VERIFICATION_TOKEN === 'true') response.verificationToken = verificationToken;
      return response;
    }
    const session = await this.createSession(user, dto.remember, context);
    return process.env.EXPOSE_EMAIL_VERIFICATION_TOKEN === 'true' ? { ...session, verificationToken } : session;
  }

  async login(dto: LoginDto, context: { userAgent?: string; ip?: string } = {}) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();

    if (!user || !user.active || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }
    if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !user.emailVerifiedAt) throw new UnauthorizedException('Confirme seu e-mail antes de entrar.');
    return this.createSession(user, dto.remember, context);
  }

  async profile(userId: string) {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new UnauthorizedException('Usuário não encontrado.');
    return this.publicUser(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto, currentSessionId?: string) {
    const user = await this.users.createQueryBuilder('user').addSelect('user.passwordHash').where('user.id = :id', { id: userId }).getOne();
    if (!user || !user.active) throw new UnauthorizedException();
    const email = dto.email?.trim().toLowerCase() || user.email;
    const emailChanged = email !== user.email;
    if (emailChanged || dto.newPassword) {
      if (!dto.currentPassword || !(await compare(dto.currentPassword, user.passwordHash))) throw new BadRequestException('Informe sua senha atual corretamente.');
      const existing = await this.users.findOneBy({ email });
      if (existing && existing.id !== userId) throw new ConflictException('Este e-mail já está cadastrado.');
    }
    user.name = dto.name.trim(); user.lastName = ''; user.phone = dto.phone.replace(/\D/g, '');
    if (emailChanged) { user.email = email; user.emailVerifiedAt = null; }
    if (dto.newPassword) user.passwordHash = await hash(dto.newPassword, 12);
    await this.users.save(user);
    if (dto.newPassword || emailChanged) await this.revokeAllSessions(userId, emailChanged ? undefined : currentSessionId);
    return this.publicUser(user);
  }

  async requestPasswordReset(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.users.findOneBy({ email, active: true });
    const generic = { message: 'Se a conta existir, as instruções de recuperação estarão disponíveis.' };
    if (!user) return generic;
    await this.passwordResets.delete({ userId: user.id });
    const token = randomBytes(32).toString('hex');
    await this.passwordResets.save(this.passwordResets.create({
      userId: user.id,
      tokenHash: this.tokenHash(token),
      expiresAt: new Date(Date.now() + 30 * 60_000)
    }));
    await this.sendTransactionalEmail(user.email,'Recuperação de senha',`Use este código para redefinir sua senha: <strong>${token}</strong>`);
    return process.env.EXPOSE_PASSWORD_RESET_TOKEN === 'true' ? { ...generic, resetToken: token } : generic;
  }

  async confirmPasswordReset(dto: ConfirmPasswordResetDto) {
    const reset = await this.passwordResets.findOneBy({ tokenHash: this.tokenHash(dto.token) });
    if (!reset || reset.usedAt || reset.expiresAt.getTime() < Date.now()) throw new BadRequestException('Link de recuperação inválido ou expirado.');
    const user = await this.users.createQueryBuilder('user').addSelect('user.passwordHash').where('user.id = :id', { id: reset.userId }).getOne();
    if (!user?.active) throw new BadRequestException('Conta indisponível.');
    user.passwordHash = await hash(dto.password, 12);
    reset.usedAt = new Date();
    await this.users.save(user);
    await this.passwordResets.save(reset);
    await this.revokeAllSessions(user.id);
    return { ok: true };
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.tokenHash(refreshToken);
    const session = await this.sessions.createQueryBuilder('session').addSelect('session.refreshTokenHash').where('session.refreshTokenHash = :tokenHash', { tokenHash }).getOne();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    const user = await this.users.findOneBy({ id: session.userId, active: true });
    if (!user) throw new UnauthorizedException('Conta indisponível.');
    const nextRefreshToken = randomBytes(48).toString('hex');
    session.refreshTokenHash = this.tokenHash(nextRefreshToken);
    await this.sessions.save(session);
    return {
      accessToken: await this.accessToken(user, session.id),
      refreshToken: nextRefreshToken,
      user: this.publicUser(user)
    };
  }

  async listSessions(userId: string, currentSessionId?: string) {
    const rows = await this.sessions.find({ where: { userId }, order: { updatedAt: 'DESC' }, take: 50 });
    return rows.filter(row => !row.revokedAt && row.expiresAt.getTime() > Date.now()).map(row => ({ id: row.id, userAgent: row.userAgent, ipAddress: row.ipAddress, createdAt: row.createdAt, updatedAt: row.updatedAt, expiresAt: row.expiresAt, current: row.id === currentSessionId }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.sessions.findOneBy({ id: sessionId, userId });
    if (!session) throw new BadRequestException('Sessão não encontrada.');
    session.revokedAt = new Date();
    await this.sessions.save(session);
    return { ok: true };
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string) {
    const rows = await this.sessions.find({ where: { userId } });
    const now = new Date();
    for (const row of rows) if (!exceptSessionId || row.id !== exceptSessionId) row.revokedAt = now;
    if (rows.length) await this.sessions.save(rows);
    return { ok: true, revoked: rows.filter(row => !exceptSessionId || row.id !== exceptSessionId).length };
  }

  async requestEmailVerification(emailInput:string){const user=await this.users.findOneBy({email:emailInput.trim().toLowerCase(),active:true});const generic:any={message:'Se a conta existir, enviaremos um código de confirmação.'};if(!user||user.emailVerifiedAt)return generic;const token=await this.issueEmailVerification(user);if(process.env.EXPOSE_EMAIL_VERIFICATION_TOKEN==='true')generic.verificationToken=token;return generic;}
  async confirmEmailVerification(token:string){const row=await this.emailVerifications.findOneBy({tokenHash:this.tokenHash(token)});if(!row||row.usedAt||row.expiresAt.getTime()<Date.now())throw new BadRequestException('Código de confirmação inválido ou expirado.');const user=await this.users.findOneBy({id:row.userId,active:true});if(!user)throw new BadRequestException('Conta indisponível.');row.usedAt=new Date();user.emailVerifiedAt=new Date();await Promise.all([this.emailVerifications.save(row),this.users.save(user)]);return{ok:true};}

  private tokenHash(token: string) { return createHash('sha256').update(token).digest('hex'); }

  private async createSession(user: UserEntity, remember = false, context: { userAgent?: string; ip?: string } = {}) {
    const refreshToken = randomBytes(48).toString('hex');
    const session = await this.sessions.save(this.sessions.create({
      userId: user.id,
      refreshTokenHash: this.tokenHash(refreshToken),
      expiresAt: new Date(Date.now() + (remember ? 30 : 1) * 24 * 60 * 60_000),
      userAgent: String(context.userAgent || '').slice(0, 500),
      ipAddress: String(context.ip || '').slice(0, 80)
    }));
    return { accessToken: await this.accessToken(user, session.id), refreshToken, user: this.publicUser(user) };
  }

  private accessToken(user: UserEntity, sessionId: string) {
    return this.jwtService.signAsync({ sub: user.id, email: user.email, sid: sessionId }, { expiresIn: '15m' });
  }

  private async shouldBootstrapAdmin(email:string){if(await this.users.count())return false;const configured=process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();return process.env.NODE_ENV!=='production'||Boolean(configured&&configured===email);}
  private async issueEmailVerification(user:UserEntity){await this.emailVerifications.delete({userId:user.id});const token=randomBytes(32).toString('hex');await this.emailVerifications.save(this.emailVerifications.create({userId:user.id,tokenHash:this.tokenHash(token),expiresAt:new Date(Date.now()+24*60*60_000)}));await this.sendTransactionalEmail(user.email,'Confirme seu e-mail',`Use este código para confirmar seu e-mail: <strong>${token}</strong>`);return token;}
  private async sendTransactionalEmail(to:string,subject:string,html:string){const endpoint=process.env.MAIL_DELIVERY_WEBHOOK_URL?.trim();if(!endpoint)return false;try{const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...(process.env.MAIL_DELIVERY_TOKEN?{authorization:`Bearer ${process.env.MAIL_DELIVERY_TOKEN}`}:{})},body:JSON.stringify({to,subject,fromName:process.env.MAIL_FROM_NAME||'Astro Builder',html,reference:`transactional-${Date.now()}`}),signal:AbortSignal.timeout(10000)});return response.ok;}catch{return false;}}

  private publicUser(user: UserEntity) {
    return {
      id: user.id,
      name: `${user.name} ${user.lastName}`.trim(),
      firstName: user.name,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt
      ,emailVerified: Boolean(user.emailVerifiedAt)
    };
  }
}
