import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { jwtSecret } from '../config/local-config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UserEntity } from './user.entity';
import { PasswordResetEntity } from './password-reset.entity';
import { AuthSessionEntity } from './auth-session.entity';
import { EmailVerificationEntity } from './email-verification.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, PasswordResetEntity, AuthSessionEntity, EmailVerificationEntity]),
    JwtModule.register({ global: true, secret: jwtSecret })
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, TypeOrmModule]
})
export class AuthModule {}
