import { ArrayMaxSize, IsArray, IsInt, IsObject, IsOptional, Min } from 'class-validator';

export class SaveWorkspaceDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  revision?: number;

  @IsArray()
  @ArrayMaxSize(1000)
  pages: unknown[];

  @IsArray()
  @ArrayMaxSize(500)
  folders: unknown[];

  @IsArray()
  @ArrayMaxSize(250)
  templates: unknown[];

  @IsArray()
  @ArrayMaxSize(5000)
  versions: unknown[];

  @IsArray()
  @ArrayMaxSize(5000)
  metrics: unknown[];

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
