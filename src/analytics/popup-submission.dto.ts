import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, IsOptional, MaxLength, MinLength, ValidateNested } from 'class-validator';
class PopupFieldDto {
  @IsString() @MinLength(1) @MaxLength(120) id: string;
  @IsString() @MaxLength(100) label: string;
  @IsString() @MaxLength(2000) value: string;
}
export class PopupSubmissionDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) visitorId?: string;
  @IsString() @MinLength(1) @MaxLength(120) pageId: string;
  @IsString() @MinLength(1) @MaxLength(120) popupId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => PopupFieldDto) fields: PopupFieldDto[];
}
