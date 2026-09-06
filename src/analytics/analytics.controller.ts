import { Body, Controller, Get, Post, Req, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { PopupSubmissionDto } from './popup-submission.dto';
import { PopupSubmissionService } from './popup-submission.service';
import { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceService } from '../workspace/workspace.service';
import { TrackEventDto } from './analytics.dto';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly popups: PopupSubmissionService,
    private readonly analytics: AnalyticsService,
    private readonly workspace: WorkspaceService
  ) {}

  @Post('popup-submissions')
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

  @Post('events')
  track(@Body() dto: TrackEventDto, @Req() request: Request) {
    return this.analytics.track(dto, request);
  }

  @UseGuards(JwtAuthGuard)
  @Get('summary')
  async summary(@CurrentUser() user: AuthenticatedUser) {
    const workspace = await this.workspace.getByUserId(user.userId);
    const pageIds = (workspace.data?.pages || []).map((page: any) => String(page?.id || '')).filter(Boolean);
    return this.analytics.summary(pageIds);
  }
}
