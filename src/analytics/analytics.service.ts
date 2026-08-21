import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { TrackEventDto } from './analytics.dto';
import { AnalyticsEventEntity } from './analytics-event.entity';

const allowedTypes = new Set(['page_view', 'cta_click', 'form_submit', 'scroll_depth', 'time_on_page', 'video_play', 'video_progress', 'video_complete', 'quiz_answer']);

@Injectable()
export class AnalyticsService {
  constructor(@InjectRepository(AnalyticsEventEntity) private readonly events: Repository<AnalyticsEventEntity>) {}

  async track(dto: TrackEventDto, request: Request) {
    const type = allowedTypes.has(dto.type) ? dto.type : 'info';
    const row = this.events.create({
      userId: null,
      pageId: this.clean(dto.pageId, 120),
      pageName: this.clean(dto.pageName || '', 160),
      type,
      target: this.clean(dto.target || '', 220),
      value: Math.max(0, Math.min(86400, Number(dto.value) || 0)),
      sessionId: this.clean(dto.sessionId || '', 80),
      referrer: this.clean(dto.referrer || '', 120),
      userAgent: this.clean(String(request.headers['user-agent'] || ''), 500),
      meta: dto.meta || null
    });
    await this.events.save(row);
    return { ok: true };
  }

  async summary(pageIds: string[] = []) {
    const rows = await this.events.find({ order: { createdAt: 'DESC' }, take: 20000 });
    const allowedPageIds = new Set(pageIds.filter(Boolean));
    const scoped = allowedPageIds.size ? rows.filter(row => allowedPageIds.has(row.pageId)) : rows;
    const byPage = new Map<string, any>();
    const videos = new Map<string, any>();
    const sessions = new Set<string>();

    for (const event of scoped) {
      const page = byPage.get(event.pageId) || {
        pageId: event.pageId,
        pageName: event.pageName,
        views: 0,
        clicks: 0,
        forms: 0,
        maxScroll: 0,
        timeSeconds: 0,
        videoPlays: 0,
        videoSeconds: 0,
        sessions: new Set<string>()
      };
      if (event.sessionId) {
        page.sessions.add(event.sessionId);
        sessions.add(event.sessionId);
      }
      if (event.type === 'page_view') page.views += 1;
      if (event.type === 'cta_click') page.clicks += 1;
      if (event.type === 'form_submit') page.forms += 1;
      if (event.type === 'scroll_depth') page.maxScroll = Math.max(page.maxScroll, event.value);
      if (event.type === 'time_on_page') page.timeSeconds += event.value;
      if (event.type === 'video_play') page.videoPlays += 1;
      if (event.type === 'video_progress' || event.type === 'video_complete') page.videoSeconds += event.value;
      byPage.set(event.pageId, page);

      if (event.type.startsWith('video_')) {
        const key = `${event.pageId}:${event.target || 'video'}`;
        const video = videos.get(key) || { pageId: event.pageId, target: event.target || 'video', plays: 0, completions: 0, watchedSeconds: 0, sessions: new Set<string>() };
        if (event.sessionId) video.sessions.add(event.sessionId);
        if (event.type === 'video_play') video.plays += 1;
        if (event.type === 'video_complete') video.completions += 1;
        if (event.type === 'video_progress' || event.type === 'video_complete') video.watchedSeconds += event.value;
        videos.set(key, video);
      }
    }

    const pages = [...byPage.values()].map(page => ({
      ...page,
      sessions: page.sessions.size,
      avgTimeSeconds: page.sessions.size ? Math.round(page.timeSeconds / page.sessions.size) : 0
    }));
    const videoDashboards = [...videos.values()].map(video => ({
      ...video,
      sessions: video.sessions.size,
      avgWatchedSeconds: video.sessions.size ? Math.round(video.watchedSeconds / video.sessions.size) : 0
    }));
    return {
      totals: {
        views: pages.reduce((sum, page) => sum + page.views, 0),
        clicks: pages.reduce((sum, page) => sum + page.clicks, 0),
        forms: pages.reduce((sum, page) => sum + page.forms, 0),
        sessions: sessions.size,
        avgTimeSeconds: pages.length ? Math.round(pages.reduce((sum, page) => sum + page.avgTimeSeconds, 0) / pages.length) : 0
      },
      pages,
      videos: videoDashboards
    };
  }

  private clean(value: string, max: number) {
    return String(value || '').replace(/[<>]/g, '').slice(0, max);
  }
}
