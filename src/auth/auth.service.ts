import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { Repository } from 'typeorm';
import { LoginDto, RegisterDto } from './auth.dto';
import { UserEntity } from './user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly jwtService: JwtService
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.users.exists({ where: { email } })) {
      throw new ConflictException('Este e-mail já está cadastrado.');
    }

    const user = this.users.create({
      name: dto.name.trim(),
      lastName: dto.lastName?.trim() || '',
      email,
      passwordHash: await hash(dto.password, 12),
      role: await this.users.count() === 0 ? 'admin' : 'user',
      active: true
    });
    await this.users.save(user);
    return this.createSession(user, dto.remember);
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();

    if (!user || !user.active || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }
    return this.createSession(user, dto.remember);
  }

  async profile(userId: string) {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new UnauthorizedException('Usuário não encontrado.');
    return this.publicUser(user);
  }

  private async createSession(user: UserEntity, remember = false) {
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email },
      { expiresIn: remember ? '7d' : '12h' }
    );
    return { accessToken, user: this.publicUser(user) };
  }

  private publicUser(user: UserEntity) {
    return {
      id: user.id,
      name: `${user.name} ${user.lastName}`.trim(),
      firstName: user.name,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt
    };
  }
}
