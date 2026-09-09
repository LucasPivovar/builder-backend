import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
export class CreateEmailContactDto { @IsEmail() @MaxLength(255) email:string; @IsOptional() @IsString() @MaxLength(160) name?:string; @IsString() @Length(2,80) consentSource:string; }
export class UpdateEmailContactDto { @IsOptional() @IsString() @MaxLength(160) name?:string; @IsOptional() @IsIn(['subscribed','unsubscribed']) status?:'subscribed'|'unsubscribed'; }
export class CreateEmailCampaignDto { @IsString() @Length(2,160) name:string; @IsString() @Length(2,220) subject:string; @IsString() @Length(2,160) fromName:string; @IsString() @Length(1,120) pageId:string; @IsString() @Length(20,2000000) html:string; }
export class EmailBounceDto { @IsString() @Length(1,255) providerId:string; @IsIn(['bounce','complaint','delivered']) event:'bounce'|'complaint'|'delivered'; }
