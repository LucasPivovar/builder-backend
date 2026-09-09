import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { resolve4, resolve6, resolveCname } from 'dns/promises';
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { isAbsolute, join, relative, resolve } from 'path';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { dnsCnameTarget, domainVerificationMode, frontendOrigins, publicBaseUrl, publicServerIps, publicationLimits, publishedSitesDirectory } from '../config/local-config';
import { NotificationsService } from '../notifications/notifications.service';
import { PublishPageDto } from './publication.dto';
import { PublicationEntity } from './publication.entity';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { UserEntity } from '../auth/user.entity';
import { BillingService } from '../billing/billing.service';
import { analyticsSignature } from '../config/analytics-signature';
import { DomainProvisionerService } from './domain-provisioner.service';

type DomainCheck = { status: 'none' | 'pending' | 'active'; error: string | null };

@Injectable()
export class PublicationService {
  constructor(
    @InjectRepository(PublicationEntity) private readonly publications: Repository<PublicationEntity>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @InjectRepository(WorkspaceEntity) private readonly workspaces: Repository<WorkspaceEntity>,
    private readonly billing: BillingService,
    private readonly domainProvisioner: DomainProvisionerService
  ) {}

  async publish(userId: string, dto: PublishPageDto) {
    const pageId = this.cleanSegment(dto.pageId, 'pagina');
    let publication = await this.publications.findOneBy({ userId, pageId });
    const workspace = await this.workspaces.findOneBy({ userId });
    const page: any = workspace?.data.pages.find((page: any) => page.id === dto.pageId);
    const folder: any = workspace?.data.folders.find((folder: any) => folder.id === page?.folderId);
    const slug = this.cleanSegment(dto.slug || page?.pageSettings?.publicationSlug || publication?.slug || dto.pageName, 'pagina');
    const userPrefix = this.cleanSegment(userId.slice(0, 8), 'user');
    const siteKey = publication?.siteKey || await this.uniqueSiteKey(`${userPrefix}-${slug}`, userId, pageId);
    const targetDirectory = this.resolveSiteDirectory(siteKey);
    const customDomain = this.normalizeDomain(folder?.customDomain || '');

    if (Buffer.byteLength(dto.html, 'utf8') > publicationLimits.maxHtmlBytes) {
      throw new BadRequestException(`HTML maior que o limite de ${publicationLimits.maxHtmlBytes} bytes.`);
    }

    if (!this.looksLikeHtml(dto.html)) {
      throw new BadRequestException('Envie um HTML completo para publicação.');
    }

    await this.assertPublicationQuota(userId, Boolean(publication), customDomain, publication?.customDomain || null);
    let domainCheck: DomainCheck = this.emptyDomainCheck();
    if (customDomain) {
      this.assertAllowedDomain(customDomain);
      const assigned = await this.publications.find({ where: { customDomain } });
      if (assigned.some(item => item.id !== publication?.id && (item.userId !== userId || !folder?.id || item.folderId !== folder.id || item.slug === slug))) throw new ConflictException('Domínio ou slug já está em uso.');
      domainCheck = await this.verifyDomain(customDomain);
    }
    const previousPath = publication?.sitePath;
    const publishedHtml = this.withAnalyticsTracking(dto.html, pageId, dto.pageName.trim());
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(join(targetDirectory, 'index.html'), publishedHtml, 'utf8');

    if (previousPath && previousPath !== targetDirectory) {
      await this.removeOldDirectory(previousPath);
    }

    publication = this.publications.create({
      ...publication,
      userId,
      pageId,
      pageName: dto.pageName.trim(),
      folderId: folder?.id || null,
      slug,
      siteKey,
      customDomain,
      domainStatus: customDomain ? domainCheck.status : 'none',
      domainVerifiedAt: domainCheck.status === 'active' ? new Date() : null,
      domainLastCheckedAt: customDomain ? new Date() : null,
      domainVerificationError: customDomain ? domainCheck.error : null,
      publicUrl: `${publicBaseUrl}/p/${siteKey}/`,
      customDomainUrl: customDomain ? `https://${customDomain}/${slug}/` : null,
      sitePath: targetDirectory,
      publishedAt: new Date()
    });
    await this.publications.save(publication);
    if (publication.customDomain && publication.domainStatus === 'active') {
      await this.domainProvisioner.provision(publication.customDomain);
    }
    await this.notifications.create(userId, {
      title: customDomain && publication.domainStatus !== 'active' ? 'Publicação pendente' : 'Página publicada',
      message: customDomain && publication.domainStatus !== 'active'
        ? `Sua página ${publication.pageName} foi publicada, mas o DNS ainda está pendente.`
        : `Sua página ${publication.pageName} foi publicada com sucesso.`,
      type: customDomain && publication.domainStatus !== 'active' ? 'pending' : 'success',
      action: 'projects'
    });
    await this.audit.record({
      userId,
      type: customDomain && publication.domainStatus !== 'active' ? 'pending' : 'success',
      title: 'Página publicada',
      message: `A página ${publication.pageName} do usuário ${userId} foi publicada.`,
      pageId,
      pageName: publication.pageName,
      meta: { publicUrl: publication.publicUrl, customDomain: publication.customDomain, domainStatus: publication.domainStatus }
    });
    return this.response(publication);
  }

  async list(userId: string) {
    const rows = await this.publications.find({ where: { userId }, order: { updatedAt: 'DESC' } });
    return rows.map((publication) => this.response(publication));
  }

  async ensureTrackingForAllPublications() {
    const rows = await this.publications.find();
    await Promise.all(rows.map(async (publication) => {
      const indexPath = this.resolvePublishedFile(publication.sitePath, 'index.html');
      const html = await readFile(indexPath, 'utf8').catch(() => '');
      if (!html) return;
      const trackedHtml = this.withAnalyticsTracking(html, publication.pageId, publication.pageName);
      if (trackedHtml !== html) await writeFile(indexPath, trackedHtml, 'utf8');
    }));
  }

  async remove(userId: string, id: string) {
    const publication = await this.publications.findOneBy({ id, userId });
    if (!publication) throw new NotFoundException('Publicação não encontrada.');
    await this.removeOldDirectory(publication.sitePath);
    if (publication.customDomain) {
      const remaining = await this.publications.count({ where: { customDomain: publication.customDomain } });
      if (remaining <= 1) await this.domainProvisioner.remove(publication.customDomain);
    }
    await this.publications.remove(publication);
    await this.notifications.create(userId, { title: 'Página despublicada', message: `Sua página ${publication.pageName} saiu do ar.`, type: 'warning', action: 'projects' });
    await this.audit.record({ userId, type: 'warning', title: 'Página despublicada', message: `A página ${publication.pageName} foi despublicada.`, pageId: publication.pageId, pageName: publication.pageName });
    return { ok: true };
  }

  async verifyPublicationDomain(userId: string, id: string) {
    const publication = await this.publications.findOneBy({ id, userId });
    if (!publication) throw new NotFoundException('Publicação não encontrada.');
    if (!publication.customDomain) throw new BadRequestException('Esta publicação não possui domínio customizado.');

    this.assertAllowedDomain(publication.customDomain);
    const domainCheck = await this.verifyDomain(publication.customDomain);
    publication.domainStatus = domainCheck.status;
    publication.domainVerifiedAt = domainCheck.status === 'active' ? new Date() : null;
    publication.domainLastCheckedAt = new Date();
    publication.domainVerificationError = domainCheck.error;
    await this.publications.save(publication);
    if (publication.domainStatus === 'active') {
      await this.domainProvisioner.provision(publication.customDomain);
    }
    await this.notifications.create(userId, {
      title: domainCheck.status === 'active' ? 'DNS validado' : 'DNS pendente',
      message: domainCheck.status === 'active' ? `O domínio da página ${publication.pageName} está ativo.` : `O DNS da página ${publication.pageName} ainda está pendente.`,
      type: domainCheck.status === 'active' ? 'success' : 'pending',
      action: 'projects'
    });
    return this.response(publication);
  }

  async findByDomain(hostname: string, pathname = '/') {
    const domain = this.normalizeDomain(hostname);
    if (!domain) return null;
    const publications = await this.publications.find({ where: { customDomain: domain, domainStatus: 'active' } });
    if (!publications.length) return null;
    const path = pathname.replace(/^\/+|\/+$/g, '');
    if (path) {
      return publications.find(publication => publication.slug === path) || null;
    }
    return (
      publications.find(p => p.slug === '' || p.slug === 'index' || p.slug === 'home') ||
      publications.find(p => !p.folderId) ||
      publications[0] ||
      null
    );
  }

  async readPublishedIndex(publication: PublicationEntity) {
    const indexPath = this.resolvePublishedFile(publication.sitePath, 'index.html');
    const fileStat = await stat(indexPath).catch(() => null);
    if (!fileStat?.isFile()) return null;
    return readFile(indexPath, 'utf8');
  }

  private response(publication: PublicationEntity) {
    return {
      id: publication.id,
      pageId: publication.pageId,
      pageName: publication.pageName,
      slug: publication.slug,
      publicUrl: publication.publicUrl,
      customDomain: publication.customDomain,
      customDomainUrl: publication.customDomainUrl,
      domainStatus: publication.domainStatus,
      domainVerifiedAt: publication.domainVerifiedAt,
      domainLastCheckedAt: publication.domainLastCheckedAt,
      domainVerificationError: publication.domainVerificationError,
      dns: publication.customDomain ? {
        type: 'CNAME',
        host: publication.customDomain,
        value: dnsCnameTarget,
        cname: dnsCnameTarget,
        ips: publicServerIps
      } : null,
      publishedAt: publication.publishedAt,
      updatedAt: publication.updatedAt
    };
  }

  private cleanSegment(value: string, fallback: string) {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70);
    return normalized || fallback;
  }

  private async uniqueSiteKey(base: string, userId: string, pageId: string) {
    const existing = await this.publications.findOneBy({ userId, pageId });
    if (existing) return existing.siteKey;

    let candidate = base.slice(0, 110);
    let suffix = 2;
    while (await this.publications.findOneBy({ siteKey: candidate })) {
      candidate = `${base.slice(0, 104)}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private looksLikeHtml(html: string) {
    const sample = html.slice(0, 500).toLowerCase();
    return sample.includes('<!doctype html') || sample.includes('<html');
  }

  private withAnalyticsTracking(html: string, pageId: string, pageName: string) {
    const signature = analyticsSignature(pageId);
    const popupContext = `<script data-popup-context>window.__builderPopupPageId=${JSON.stringify(pageId).replace(/</g, '\\u003c')};window.__builderAnalyticsSignature=${JSON.stringify(signature)};</script>`;
    html = html.replace(/<script data-popup-context>[\s\S]*?<\/script>/g, '');
    html = html.replace(/<head[^>]*>/i, match => match + popupContext);
    const marker = 'data-builder-analytics="server"';
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, block =>
      block.includes(marker) || block.includes("var sessionKey = 'ab_session_'") ? '' : block);

    const script = `
<script ${marker}>
(function(){
  var pageId = ${JSON.stringify(pageId)};
  var pageName = ${JSON.stringify(pageName)};
  var sessionKey = 'ab_session_' + pageId;
  var sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  var viewed = false;
  try { sessionId = localStorage.getItem(sessionKey) || sessionId; localStorage.setItem(sessionKey, sessionId); viewed = localStorage.getItem('ab_viewed_' + pageId) === '1'; } catch (_) {}
  var startedAt = Date.now();
  var countingTime = !document.hidden;
  function flushTime() {
    var now = Date.now();
    if (countingTime) {
      var seconds = Math.floor((now - startedAt) / 1000);
      if (seconds > 0) send('time_on_page', 'page', seconds);
    }
    startedAt = now;
  }
  document.addEventListener('visibilitychange', function(){ flushTime(); countingTime = !document.hidden; });
  window.addEventListener('pagehide', function(){ flushTime(); countingTime = false; });
  window.addEventListener('pageshow', function(){ startedAt = Date.now(); countingTime = !document.hidden; });
  var maxScroll = 0;
  function send(type, target, value, meta) {
    if (document.hidden && type.indexOf('video_') === 0) return;
    if (type === 'video_progress') {
      try {
        var progressKey = 'ab_progress_' + pageId + '_' + target;
        var previous = Number(localStorage.getItem(progressKey)) || 0;
        var current = Number(meta && meta.currentTime) || 0;
        if (current <= previous) return;
        value = Math.min(Number(value) || 0, current - previous);
        localStorage.setItem(progressKey, String(current));
      } catch (_) {}
    }
    if (type === 'video_complete') value = 0;
    var uniqueKey = 'ab_metric_' + pageId + '_' + type + '_' + (target || '');
    if (['cta_click', 'video_play', 'video_complete', 'form_submit', 'quiz_step', 'quiz_complete', 'quiz_answer'].indexOf(type) !== -1) {
      try { if (localStorage.getItem(uniqueKey)) return; localStorage.setItem(uniqueKey, '1'); } catch (_) {}
    }
    var body = JSON.stringify({
      pageId: pageId,
      pageName: pageName,
      type: type,
      target: target || '',
      value: Number(value) || 0,
      sessionId: sessionId,
      referrer: document.referrer || '',
      meta: meta || {}
      ,signature: window.__builderAnalyticsSignature || ''
    });
    try {
      fetch('/api/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).then(function(response){ try { if (!response.ok) localStorage.removeItem(uniqueKey); else if (type === 'page_view') localStorage.setItem('ab_viewed_' + pageId, '1'); } catch (_) {} }).catch(function(){ try { localStorage.removeItem(uniqueKey); } catch (_) {} });
    } catch (e) {
      try {
        if (navigator.sendBeacon) navigator.sendBeacon('/api/analytics/events', new Blob([body], { type: 'application/json' }));
      } catch (_) {}
    }
  }
  if (!viewed) send('page_view', 'page', 1);
  document.addEventListener('quiz:step', function(event){ send('quiz_step', 'Etapa ' + (event.detail.index + 1), 1); });
  document.addEventListener('quiz:answer', function(event){ send('quiz_answer', 'Etapa ' + (event.detail.index + 1), 1, { answer: event.detail.answers.join(', ') }); });
  document.addEventListener('quiz:complete', function(){ send('quiz_complete', 'quiz', 1); });
  document.addEventListener('click', function(event) {
    var target = event.target.closest && event.target.closest('a, button, [role="button"], .canvas-btn, .canvas-pitch-btn');
    if (target && !target.closest('vturb-smartplayer, .canvas-vturb-wrapper')) send('cta_click', (target.innerText || target.getAttribute('aria-label') || target.getAttribute('href') || 'Sem texto').trim().slice(0, 220), 1, { href: target.getAttribute('href') || '', buttonId: target.id || '' });
  });
  document.addEventListener('submit', function(event) {
    if (!event.target.closest('[data-popup-id]')) send('form_submit', event.target.getAttribute('action') || 'form', 1);
  });
  window.addEventListener('scroll', function() {
    var doc = document.documentElement;
    var height = Math.max(1, doc.scrollHeight - window.innerHeight);
    maxScroll = Math.max(maxScroll, Math.round((window.scrollY / height) * 100));
  }, { passive: true });
  setInterval(flushTime, 15000);
  window.addEventListener('beforeunload', function(){ send('scroll_depth', 'page', maxScroll); flushTime(); countingTime = false; });
  function bindVideos() {
    document.querySelectorAll('video').forEach(function(video, index) {
      if (video.closest('vturb-smartplayer, .canvas-vturb-wrapper')) return;
      if (video.dataset.builderAnalyticsBound) return;
      video.dataset.builderAnalyticsBound = '1';
      var target = video.getAttribute('id') || video.getAttribute('src') || ('video-' + (index + 1));
      var last = 0;
      document.addEventListener('visibilitychange', function(){ last = Math.round(video.currentTime || 0); });
      var interacted = false, played = false;
      video.addEventListener('pointerdown', function(){ interacted = true; });
      video.addEventListener('keydown', function(){ interacted = true; });
      video.addEventListener('play', function(){ if (interacted && !played) { played = true; send('video_play', target, Math.round(video.currentTime || 0)); } });
      video.addEventListener('timeupdate', function(){
        var now = Math.round(video.currentTime || 0);
        if (document.hidden) { last = now; return; }
        if (now - last >= 5) { last = now; send('video_progress', target, 5, { currentTime: now, duration: Math.round(video.duration || 0) }); }
      });
      video.addEventListener('ended', function(){ send('video_complete', target, Math.round(video.duration || video.currentTime || 0)); });
    });
    document.querySelectorAll('vturb-smartplayer, .canvas-vturb-wrapper').forEach(function(player, index) {
      if (player.matches('.canvas-vturb-wrapper') && player.querySelector('vturb-smartplayer')) return;
      if (player.dataset.builderAnalyticsBound) return;
      player.dataset.builderAnalyticsBound = '1';
      var smart = player.matches && player.matches('vturb-smartplayer') ? player : player.querySelector('vturb-smartplayer');
      var target = (smart && smart.getAttribute('id')) || ('vturb-' + (index + 1));
      var played = false;
      var lastProgress = 0;
      var resetProgress = false;
      document.addEventListener('visibilitychange', function(){ resetProgress = true; });
      function markPlay(value) {
        if (!played) {
          played = true;
          send('video_play', target, Number(value) || 0, { provider: 'vturb' });
        }
      }
      player.addEventListener('click', function(){ markPlay(0); });
      setInterval(function() {
        try {
          var instances = window.smartplayer && window.smartplayer.instances ? window.smartplayer.instances : [];
          instances.forEach(function(inst) {
            var video = inst && inst.video;
            if (!video || !(video.currentTime > 0)) return;
            if (!played) return;
            var now = Math.round(video.currentTime || 0);
            if (document.hidden || resetProgress) { lastProgress = now; resetProgress = false; return; }
            if (now - lastProgress >= 5) {
              lastProgress = now;
              send('video_progress', target, 5, { provider: 'vturb', currentTime: now, duration: Math.round(video.duration || 0) });
            }
            if (video.ended) send('video_complete', target, Math.round(video.duration || video.currentTime || 0), { provider: 'vturb' });
          });
        } catch (e) {}
      }, 1000);
    });
  }
  bindVideos();
  setInterval(bindVideos, 3000);
})();
</script>`;
    if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${script}\n</head>`);
    if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${script}\n</body>`);
    return `${html}\n${script}`;
  }

  private resolveSiteDirectory(siteKey: string) {
    const directory = resolve(publishedSitesDirectory, siteKey);
    if (!this.isInsidePublishedDirectory(directory)) {
      throw new BadRequestException('Destino de publicação inválido.');
    }
    return directory;
  }

  private async removeOldDirectory(sitePath: string) {
    const resolved = resolve(sitePath);
    if (!this.isInsidePublishedDirectory(resolved)) return;
    await rm(resolved, { recursive: true, force: true });
  }

  private resolvePublishedFile(sitePath: string, filename: string) {
    const resolvedDirectory = resolve(sitePath);
    const resolvedFile = resolve(resolvedDirectory, filename);
    if (!this.isInsidePublishedDirectory(resolvedDirectory) || !resolvedFile.startsWith(resolvedDirectory)) {
      throw new BadRequestException('Arquivo publicado inválido.');
    }
    return resolvedFile;
  }

  private normalizeDomain(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '') || null;
  }

  private async assertDomainAvailable(domain: string, currentPublicationId?: string) {
    const existing = await this.publications.findOneBy({ customDomain: domain });
    if (existing && existing.id !== currentPublicationId) {
      throw new ConflictException('Este domínio já está atribuído a outra publicação.');
    }
  }

  private async assertPublicationQuota(userId: string, updatingExisting: boolean, customDomain: string | null, previousDomain: string | null) {
    const planLimits = await this.billing.limits(userId);
    if (!updatingExisting) {
      const count = await this.publications.countBy({ userId });
      if (count >= Math.min(publicationLimits.maxPublicationsPerUser, planLimits.maxPages)) {
        throw new BadRequestException('Limite de publicações atingido para este usuário.');
      }
    }

    if (customDomain && customDomain !== previousDomain) {
      const withDomain = await this.publications.find({ where: { userId } });
      const domains = new Set(withDomain.map(item => item.customDomain).filter(Boolean));
      if (!domains.has(customDomain) && domains.size >= Math.min(publicationLimits.maxCustomDomainsPerUser, planLimits.maxDomains)) {
        throw new BadRequestException('Limite de domínios customizados atingido para este usuário.');
      }
    }
  }

  private assertAllowedDomain(domain: string) {
    if (!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
      throw new BadRequestException('Informe um domínio válido.');
    }

    const blocked = new Set([
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      this.hostnameFromUrl(publicBaseUrl),
      this.normalizeDomain(dnsCnameTarget) || ''
    ]);
    for (const origin of frontendOrigins) blocked.add(this.hostnameFromUrl(origin));

    if (blocked.has(domain)) throw new BadRequestException('Este domínio não pode ser usado como domínio de cliente.');
    if (domain.endsWith('.local') || domain.endsWith('.localhost') || domain.endsWith('.internal') || domain.endsWith('.test')) {
      throw new BadRequestException('Domínio reservado não pode ser usado em produção.');
    }
  }

  private async verifyDomain(domain: string): Promise<DomainCheck> {
    if (domainVerificationMode === 'off') return { status: 'active', error: null };

    const expectedCname = this.normalizeDomain(dnsCnameTarget);
    const cnameRecords = await resolveCname(domain).catch(() => [] as string[]);
    const normalizedCnames = cnameRecords.map((record) => this.normalizeDomain(record) || '');
    if (expectedCname && normalizedCnames.includes(expectedCname)) return { status: 'active', error: null };

    const ipv4Records = await resolve4(domain).catch(() => [] as string[]);
    const ipv6Records = await resolve6(domain).catch(() => [] as string[]);
    const allIps = [...ipv4Records, ...ipv6Records];
    if (publicServerIps.length && allIps.some((ip) => publicServerIps.includes(ip))) return { status: 'active', error: null };

    return {
      status: 'pending',
      error: `DNS ainda não aponta para ${dnsCnameTarget}${publicServerIps.length ? ` ou ${publicServerIps.join(', ')}` : ''}.`
    };
  }

  private emptyDomainCheck(): DomainCheck {
    return { status: 'none', error: null };
  }

  private hostnameFromUrl(value: string) {
    try {
      return new URL(value).hostname;
    } catch {
      return this.normalizeDomain(value) || '';
    }
  }

  private isInsidePublishedDirectory(pathname: string) {
    const relation = relative(publishedSitesDirectory, pathname);
    return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
  }
}
