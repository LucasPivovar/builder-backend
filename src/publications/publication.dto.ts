import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class PublishPageDto {
  @IsString()
  @MaxLength(80)
  pageId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  pageName: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  @Matches(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i, {
    message: 'Informe um domínio válido, como pagina.seudominio.com.'
  })
  customDomain?: string;

  @IsString()
  @MinLength(20)
  @MaxLength(2_000_000)
  html: string;
}
