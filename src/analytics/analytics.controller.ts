import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkspaceService } from '../workspace/workspace.service';
import { TrackEventDto } from './analytics.dto';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly workspace: WorkspaceService
  ) {}

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
