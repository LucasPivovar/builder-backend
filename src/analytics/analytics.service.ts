import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { LessThan, Repository } from 'typeorm';
import { TrackEventDto } from './analytics.dto';
import { AnalyticsEventEntity } from './analytics-event.entity';
import { PopupSubmissionEntity } from './popup-submission.entity';
import { PublicationEntity } from '../publications/publication.entity';
import { validAnalyticsSignature } from '../config/analytics-signature';

const allowedTypes = new Set(['page_view', 'cta_click', 'form_submit', 'scroll_depth', 'time_on_page', 'video_play', 'video_progress', 'video_complete', 'quiz_answer', 'quiz_step', 'quiz_complete', 'email_click']);

@Injectable()
export class AnalyticsService implements OnModuleInit {
  constructor(@InjectRepository(AnalyticsEventEntity) private readonly events: Repository<AnalyticsEventEntity>,
    @InjectRepository(PopupSubmissionEntity) private readonly submissions: Repository<PopupSubmissionEntity>,
    @InjectRepository(PublicationEntity) private readonly publications: Repository<PublicationEntity>) {}

  async onModuleInit(){await this.applyRetention();const timer=setInterval(()=>this.applyRetention().catch(()=>undefined),24*60*60_000);timer.unref();}

  async track(dto: TrackEventDto, request: Request, trusted = false) {
    if (!trusted) {
      if (!await this.publications.exists({ where: { pageId: dto.pageId } })) throw new NotFoundException('Página não publicada.');
      if (!validAnalyticsSignature(dto.pageId,dto.signature)) throw new BadRequestException('Assinatura de analytics inválida.');
    }
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

  async summary(pageIds: string[] = [], range: { from?: Date; to?: Date } = {}) {
    const rows = await this.events.find({ order: { createdAt: 'DESC' }, take: 20000 });
    const allowedPageIds = new Set(pageIds.filter(Boolean));
    const scoped = rows.filter(row => allowedPageIds.has(row.pageId)
      && (!range.from || row.createdAt >= range.from)
      && (!range.to || row.createdAt <= range.to));
    const byPage = new Map<string, any>();
    const videos = new Map<string, any>();
    const sessions = new Set<string>();
    const views = new Set<string>();
    const buttons = new Map<string, any>();
    const quizSteps = new Map<string, any>();
    const quizAnswers = new Map<string, any>();

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
      if (event.type === 'page_view') {
        const key = event.pageId + ':' + (event.sessionId || event.id);
        if (!views.has(key)) { page.views += 1; views.add(key); }
      }
      if (event.type === 'quiz_step') {
        const key = event.pageId + ':' + event.target;
        const step = quizSteps.get(key) || { pageId: event.pageId, label: event.target, visitors: new Set() };
        step.visitors.add(event.sessionId || event.id); quizSteps.set(key, step);
        if (event.target === 'Etapa 1') page.quizStarts = (page.quizStarts || 0) + 1;
      }
      if (event.type === 'quiz_answer') {
        const key = JSON.stringify([event.pageId, event.target, event.meta?.answer]);
        const answer = quizAnswers.get(key) || { pageId: event.pageId, question: event.target, answer: String(event.meta?.answer || ''), count: 0 };
        answer.count += 1; quizAnswers.set(key, answer);
      }
      if (event.type === 'quiz_complete') page.quizCompletions = (page.quizCompletions || 0) + 1;
      if (event.type === 'cta_click' || event.type === 'email_click') {
        const key = JSON.stringify([event.pageId, event.target, event.meta?.buttonId || '', event.meta?.href || '']);
        const button = buttons.get(key) || { pageId: event.pageId, label: event.target || 'Sem texto', target: event.meta?.href || '', clicks: 0 };
        button.clicks += 1;
        buttons.set(key, button);
      }
      if (event.type === 'cta_click' || event.type === 'email_click') page.clicks += 1;
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

    const submissions = await this.submissions.find();
    for (const submission of submissions) {
      if (!allowedPageIds.has(submission.pageId)) continue;
      if (range.from && submission.createdAt < range.from) continue;
      if (range.to && submission.createdAt > range.to) continue;
      const page = byPage.get(submission.pageId) || { pageId: submission.pageId, views: 0, clicks: 0, forms: 0, maxScroll: 0, timeSeconds: 0, videoPlays: 0, videoSeconds: 0, sessions: new Set<string>() };
      page.forms += 1;
      byPage.set(submission.pageId, page);
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
      buttons: [...buttons.values()],
      quizSteps: [...quizSteps.values()].map(step => ({ ...step, visitors: step.visitors.size })),
      quizAnswers: [...quizAnswers.values()],
      videos: videoDashboards
    };
  }

  private clean(value: string, max: number) {
    return String(value || '').replace(/[<>]/g, '').slice(0, max);
  }

  private async applyRetention(){const eventDays=Math.max(1,Number(process.env.ANALYTICS_RETENTION_DAYS||365));const leadDays=Math.max(1,Number(process.env.LEAD_RETENTION_DAYS||730));await Promise.all([this.events.delete({createdAt:LessThan(new Date(Date.now()-eventDays*86400000))}),this.submissions.delete({createdAt:LessThan(new Date(Date.now()-leadDays*86400000))})]);}
}
