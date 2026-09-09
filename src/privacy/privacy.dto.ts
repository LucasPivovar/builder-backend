import { IsString, MaxLength } from 'class-validator';
export class DeleteAccountDto { @IsString() @MaxLength(72) password:string; }
