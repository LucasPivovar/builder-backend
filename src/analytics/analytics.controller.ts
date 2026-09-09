import { Body, Controller, Get, Post, Req, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { PopupSubmissionDto } from './popup-submission.dto';
import { PopupSubmissionService } from './popup-submission.service';
import { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceService } from '../workspace/workspace.service';
import { TrackEventDto } from './analytics.dto';
import { AnalyticsService } from './analytics.service';
import { Throttle } from '@nestjs/throttler';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly popups: PopupSubmissionService,
    private readonly analytics: AnalyticsService,
    private readonly workspace: WorkspaceService
  ) {}

  @Post('popup-submissions')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  submitPopup(@Body() dto: PopupSubmissionDto) { return this.popups.submit(dto); }

  @UseGuards(JwtAuthGuard)
  @Get('popup-submissions')
  popupResponses(@CurrentUser() user: AuthenticatedUser, @Query('pageId') pageId: string, @Query('page') page = '1') {
    const number = Number(page);
    if (!pageId || !Number.isSafeInteger(number) || number < 1 || number > 1000000) throw new BadRequestException('Página inválida.');
    return this.popups.list(user.userId, pageId, number);
  }

  @UseGuards(JwtAuthGuard)
  @Get('popup-submissions/export')
  async exportPopupResponses(@CurrentUser() user: AuthenticatedUser, @Query('pageId') pageId: string) {
    if (!pageId) throw new BadRequestException('Página inválida.');
    return { csv: await this.popups.export(user.userId, pageId) };
  }

  @UseGuards(JwtAuthGuard)
  @Get('webhook-deliveries')
  webhookDeliveries(@CurrentUser() user:AuthenticatedUser,@Query('page')page='1'){return this.popups.listWebhooks(user.userId,Math.max(1,Number(page)||1));}

  @Post('events')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  track(@Body() dto: TrackEventDto, @Req() request: Request) {
    return this.analytics.track(dto, request);
  }

  @UseGuards(JwtAuthGuard)
  @Get('summary')
  async summary(@CurrentUser() user: AuthenticatedUser, @Query('pageId') pageId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const workspace = await this.workspace.getByUserId(user.userId);
    const ownedPageIds = (workspace.data?.pages || []).map((page: any) => String(page?.id || '')).filter(Boolean);
    if (pageId && !ownedPageIds.includes(pageId)) throw new BadRequestException('Página inválida.');
    const parseDate = (value?: string) => {
      if (!value) return undefined;
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) throw new BadRequestException('Período inválido.');
      return date;
    };
    const range = { from: parseDate(from), to: parseDate(to) };
    if (range.from && range.to && range.from > range.to) throw new BadRequestException('Período inválido.');
    return this.analytics.summary(pageId ? [pageId] : ownedPageIds, range);
  }
}
