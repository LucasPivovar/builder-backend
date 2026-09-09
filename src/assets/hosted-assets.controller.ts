import { BadRequestException, Controller, Delete, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express'; import { randomUUID } from 'crypto'; import { diskStorage } from 'multer';
import { CurrentUser } from '../auth/current-user.decorator'; import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard'; import { hostedAssetLimits, hostedAssetsDirectory } from '../config/local-config'; import { HostedAssetsService } from './hosted-assets.service';
const types=new Map([['image/png','.png'],['image/jpeg','.jpg'],['image/gif','.gif'],['image/webp','.webp']]);
@UseGuards(JwtAuthGuard) @Controller('assets') export class HostedAssetsController {constructor(private service:HostedAssetsService){}
@Get()list(@CurrentUser()u:AuthenticatedUser){return this.service.list(u.userId)}
@Post() @UseInterceptors(FileInterceptor('asset',{storage:diskStorage({destination:hostedAssetsDirectory,filename:(_r,f,cb)=>cb(null,randomUUID()+(types.get(f.mimetype)||''))}),limits:{fileSize:hostedAssetLimits.maxBytes,files:1},fileFilter:(_r,f,cb)=>types.has(f.mimetype)?cb(null,true):cb(new BadRequestException('Use PNG, JPEG, GIF ou WebP.'),false)})) upload(@CurrentUser()u:AuthenticatedUser,@UploadedFile()f:any){return this.service.create(u.userId,f)}
@Delete(':id')remove(@CurrentUser()u:AuthenticatedUser,@Param('id')id:string){return this.service.remove(u.userId,id)}}
