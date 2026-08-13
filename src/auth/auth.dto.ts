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

export class RegisterDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;

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
