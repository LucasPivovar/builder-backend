import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateSupportTicketDto {
  @IsString() @Length(3, 140) subject: string;
  @IsString() @IsIn(['Publicação / DNS', 'Conta', 'Pagamento', 'Bug no builder', 'Dúvida geral']) category: string;
  @IsString() @IsIn(['Normal', 'Alta', 'Urgente']) priority: string;
  @IsOptional() @IsString() @MaxLength(500) pageUrl?: string;
  @IsString() @Length(10, 5000) message: string;
}

export class AdminUpdateSupportTicketDto {
  @IsString() @IsIn(['open', 'resolved']) status: 'open' | 'resolved';
  @IsOptional() @IsString() @MaxLength(5000) reply?: string;
}

export class AddSupportMessageDto {
  @IsString() @Length(2, 5000) message: string;
}
