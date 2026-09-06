import { BadRequestException, Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceService } from '../workspace/workspace.service';
import { encryptPrivateData, privateDataTransformer } from '../config/private-data';
import { publicBaseUrl } from '../config/local-config';
import { AnalyticsService } from './analytics.service';
import { randomUUID } from 'crypto';
class EmailHtmlDto {
  @IsString() @MaxLength(120) pageId: string;
  @IsString() @MaxLength(2000000) html: string;
}
@Controller('analytics/email')
export class EmailTrackingController {
  constructor(private readonly workspace: WorkspaceService, private readonly analytics: AnalyticsService) {}
  @Post('prepare') @UseGuards(JwtAuthGuard)
  async prepare(@CurrentUser() user: AuthenticatedUser, @Body() dto: EmailHtmlDto) {
    const workspace = await this.workspace.getByUserId(user.userId);
    const page: any = workspace.data.pages.find((page: any) => page.id === dto.pageId);
    if (!page || (page.type !== 'email' && page.builderMode !== 'email')) throw new BadRequestException('Salve o template de e-mail primeiro.');
    let index = 0;
    const html = dto.html.replace(/<a\b([^>]*?)href=(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi, (all, before, quote, rawUrl, after, content) => {
      const url = rawUrl.replace(/&amp;/g, '&');
      if (!/^https?:\/\//i.test(url)) return all;
      const label = content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0,220) || 'Link';
      const token = encryptPrivateData({ userId: user.userId, pageId: dto.pageId, url, label, buttonId: 'email-' + (++index) });
      return `<a${before}href=${quote}${publicBaseUrl}/api/analytics/email/click?token=${encodeURIComponent(token)}${quote}${after}>${content}</a>`;
    });
    return { html };
  }
  @Get('click')
  async click(@Query('token') token: string, @Req() request: Request, @Res() response: Response) {
    let data: any;
    try { if (!token?.startsWith('enc:v1:') || token.length > 12000) throw new Error(); data = privateDataTransformer.from(token); if (!/^https?:\/\//i.test(data.url)) throw new Error(); } catch { throw new BadRequestException('Link inválido.'); }
    const workspace = await this.workspace.getByUserId(data.userId);
    if (!workspace.data.pages.some((page: any) => page.id === data.pageId)) throw new BadRequestException('Template não disponível.');
    const cookie = request.headers.cookie?.match(/(?:^|;\s*)ab_email_visitor=([a-f0-9-]{36})(?:;|$)/)?.[1] || randomUUID();
    response.cookie('ab_email_visitor', cookie, { httpOnly: true, sameSite: 'lax', secure: request.secure, maxAge: 365*86400000 });
    await this.analytics.track({ pageId: data.pageId, type: 'email_click', target: data.label, value: 1, sessionId: cookie, meta: { href: data.url, buttonId: data.buttonId } }, request);
    response.setHeader('Cache-Control', 'no-store');
    return response.redirect(302, data.url);
  }
}
