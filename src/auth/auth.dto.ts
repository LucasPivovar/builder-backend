import { IsBoolean, IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MaxLength(72)
  password: string;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class UpdateProfileDto {
  @IsString() @Length(2, 120) name: string;
  @IsString() @Matches(/^\+?[\d\s()-]{0,20}$/) phone: string;
  @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  @IsOptional() @IsString() @MaxLength(72) currentPassword?: string;
  @IsOptional() @IsString() @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/) newPassword?: string;
}

export class RegisterDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/, {
    message: 'A senha deve ter ao menos 8 caracteres, uma letra maiúscula, uma minúscula e um número.'
  })
  password: string;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class RequestPasswordResetDto {
  @IsEmail() @MaxLength(255) email: string;
}

export class RequestEmailVerificationDto {
  @IsEmail() @MaxLength(255) email: string;
}

export class ConfirmPasswordResetDto {
  @IsString() @Length(32, 200) token: string;
  @IsString() @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/, { message: 'A senha deve ter ao menos 8 caracteres, uma letra maiúscula, uma minúscula e um número.' }) password: string;
}

export class RefreshSessionDto {
  @IsString() @Length(32, 200) refreshToken: string;
}
export class ConfirmEmailVerificationDto { @IsString() @Length(32,200) token:string; }
