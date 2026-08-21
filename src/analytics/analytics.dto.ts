import { IsNumber, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class TrackEventDto {
  @IsString() @MaxLength(120) pageId: string;
  @IsOptional() @IsString() @MaxLength(160) pageName?: string;
  @IsString() @MaxLength(40) type: string;
  @IsOptional() @IsString() @MaxLength(220) target?: string;
  @IsOptional() @IsNumber() value?: number;
  @IsOptional() @IsString() @MaxLength(80) sessionId?: string;
  @IsOptional() @IsString() @MaxLength(120) referrer?: string;
  @IsOptional() @IsObject() meta?: Record<string, unknown>;
}
