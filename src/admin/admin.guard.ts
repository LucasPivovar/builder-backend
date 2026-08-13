import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { UserEntity } from '../auth/user.entity';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@InjectRepository(UserEntity) private readonly users: Repository<UserEntity>) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.users.findOneBy({ id: request.user.userId });
    if (!user?.active || user.role !== 'admin') throw new ForbiddenException('Acesso restrito a administradores.');
    return true;
  }
}
