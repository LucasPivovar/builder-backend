import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateEmailCampaignDto, CreateEmailContactDto, EmailBounceDto, UpdateEmailContactDto } from './email.dto';
import { EmailService } from './email.service';
@Controller('email') export class EmailController {constructor(private email:EmailService){}
  @UseGuards(JwtAuthGuard) @Get('contacts')contacts(@CurrentUser()u:AuthenticatedUser,@Query('page')page='1',@Query('query')query='',@Query('status')status='all'){return this.email.listContacts(u.userId,Math.max(1,Math.min(100000,Number(page)||1)),query,status);}
  @UseGuards(JwtAuthGuard) @Post('contacts')add(@CurrentUser()u:AuthenticatedUser,@Body()dto:CreateEmailContactDto){return this.email.addContact(u.userId,dto);}
  @UseGuards(JwtAuthGuard) @Patch('contacts/:id')update(@CurrentUser()u:AuthenticatedUser,@Param('id')id:string,@Body()dto:UpdateEmailContactDto){return this.email.updateContact(u.userId,id,dto);}
  @UseGuards(JwtAuthGuard) @Delete('contacts/:id')remove(@CurrentUser()u:AuthenticatedUser,@Param('id')id:string){return this.email.removeContact(u.userId,id);}
  @UseGuards(JwtAuthGuard) @Get('campaigns')campaigns(@CurrentUser()u:AuthenticatedUser){return this.email.listCampaigns(u.userId);}
  @UseGuards(JwtAuthGuard) @Post('campaigns')create(@CurrentUser()u:AuthenticatedUser,@Body()dto:CreateEmailCampaignDto){return this.email.createCampaign(u.userId,dto);}
  @UseGuards(JwtAuthGuard) @Post('campaigns/:id/send')send(@CurrentUser()u:AuthenticatedUser,@Param('id')id:string){return this.email.sendCampaign(u.userId,id);}
  @Get('open/:id/:token.gif')async open(@Param('id')id:string,@Param('token')token:string,@Res()res:Response){await this.email.open(id,token);res.set({'content-type':'image/gif','cache-control':'no-store, no-cache, must-revalidate'}).send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64'));}
  @Get('unsubscribe/:id/:token')async unsubscribe(@Param('id')id:string,@Param('token')token:string,@Res()res:Response){await this.email.unsubscribe(id,token);res.type('html').send('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Descadastro</title><body style="font-family:Arial;padding:40px;text-align:center"><h1>Descadastro confirmado</h1><p>Este endereço não receberá novas campanhas.</p></body></html>');}
  @HttpCode(HttpStatus.OK) @Post('webhooks/delivery')bounce(@Headers('x-webhook-secret')secret:string|undefined,@Body()dto:EmailBounceDto){return this.email.bounce(secret,dto);}
}
