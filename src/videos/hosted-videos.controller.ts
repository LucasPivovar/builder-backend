import { BadRequestException, Controller, Delete, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { hostedVideoLimits, hostedVideosDirectory } from '../config/local-config';
import { HostedVideosService } from './hosted-videos.service';

const allowedTypes = new Map([
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/ogg', '.ogv'],
  ['video/quicktime', '.mov']
]);

@UseGuards(JwtAuthGuard)
@Controller('videos')
export class HostedVideosController {
  constructor(private readonly videos: HostedVideosService) {}

  @Get() list(@CurrentUser() user: AuthenticatedUser) { return this.videos.list(user.userId); }
  @Get('usage') usage(@CurrentUser() user: AuthenticatedUser) { return this.videos.usage(user.userId); }

  @Post()
  @UseInterceptors(FileInterceptor('video', {
    storage: diskStorage({
      destination: hostedVideosDirectory,
      filename: (_request, file, callback) => callback(null, `${randomUUID()}${allowedTypes.get(file.mimetype) || extname(file.originalname).toLowerCase()}`)
    }),
    limits: { fileSize: hostedVideoLimits.maxBytes, files: 1 },
    fileFilter: (_request, file, callback) => {
      if (!allowedTypes.has(file.mimetype)) return callback(new BadRequestException('Formato não suportado. Use MP4, WebM, OGV ou MOV.'), false);
      callback(null, true);
    }
  }))
  upload(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: any) {
    return this.videos.create(user.userId, file);
  }

  @Delete(':id') remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.videos.remove(user.userId, id);
  }
}
