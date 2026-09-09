import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { ConfirmEmailVerificationDto, ConfirmPasswordResetDto, LoginDto, RefreshSessionDto, RegisterDto, RequestEmailVerificationDto, RequestPasswordResetDto, UpdateProfileDto } from './auth.dto';
import { CurrentUser } from './current-user.decorator';
import { AuthenticatedUser, JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() request: Request) {
    return this.authService.register(dto, { userAgent: request.headers['user-agent'], ip: request.ip });
  }

  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.authService.login(dto, { userAgent: request.headers['user-agent'], ip: request.ip });
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password-reset/request')
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) { return this.authService.requestPasswordReset(dto.email); }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password-reset/confirm')
  confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) { return this.authService.confirmPasswordReset(dto); }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('email-verification/request') requestEmailVerification(@Body() dto: RequestEmailVerificationDto){return this.authService.requestEmailVerification(dto.email);}
  @Post('email-verification/confirm') confirmEmailVerification(@Body()dto:ConfirmEmailVerificationDto){return this.authService.confirmEmailVerification(dto.token);}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshSessionDto) { return this.authService.refresh(dto.refreshToken); }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  sessions(@CurrentUser() user: AuthenticatedUser) { return this.authService.listSessions(user.userId, user.sessionId); }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.authService.revokeSession(user.userId, id); }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions')
  revokeAll(@CurrentUser() user: AuthenticatedUser) { return this.authService.revokeAllSessions(user.userId, user.sessionId); }

  @UseGuards(JwtAuthGuard)
  @Post('profile')
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.userId, dto, user.sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.profile(user.userId);
  }
}
