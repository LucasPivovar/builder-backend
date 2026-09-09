import { Body, Controller, Get, Param, Patch, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AddSupportMessageDto, CreateSupportTicketDto } from './support-ticket.dto';
import { SupportService } from './support.service';
import { maxSupportAttachmentBytes, supportAttachmentsDirectory } from '../config/local-config';

@UseGuards(JwtAuthGuard)
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser) { return this.support.list(user.userId); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupportTicketDto) { return this.support.create(user.userId, dto); }
  @Post(':id/messages') addMessage(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddSupportMessageDto) { return this.support.addUserMessage(user.userId, id, dto.message); }
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('attachment', { storage: diskStorage({ destination: supportAttachmentsDirectory, filename: (_request, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`) }), limits: { fileSize: maxSupportAttachmentBytes, files: 1 } }))
  addAttachment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) { return this.support.addAttachment(user.userId, id, file); }
  @Get(':id/attachments/:attachmentId')
  async attachment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('attachmentId') attachmentId: string, @Res() response: Response) {
    const attachment = await this.support.getAttachment(user.userId, id, attachmentId);
    response.type(attachment.mimeType).attachment(attachment.name).sendFile(attachment.path);
  }
  @Patch(':id/resolve') resolve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.support.resolve(user.userId, id); }
}
