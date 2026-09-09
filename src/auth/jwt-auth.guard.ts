import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { jwtSecret } from '../config/local-config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthSessionEntity } from './auth-session.entity';
import { UserEntity } from './user.entity';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService, @InjectRepository(AuthSessionEntity) private readonly sessions: Repository<AuthSessionEntity>, @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Sessão ausente.');

    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string; email: string; sid: string }>(token, { secret: jwtSecret });
      if (!payload.sid) throw new Error('missing session');
      const [session, user] = await Promise.all([this.sessions.findOneBy({ id: payload.sid, userId: payload.sub }), this.users.findOneBy({ id: payload.sub })]);
      if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || !user?.active) throw new Error('inactive session');
      if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !user.emailVerifiedAt) throw new Error('unverified email');
      request.user = { userId: payload.sub, email: payload.email, sessionId: payload.sid };
      return true;
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') || [];
    return type === 'Bearer' ? token : undefined;
  }
}
