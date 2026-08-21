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

type DomainCheck = { status: 'none' | 'pending' | 'active'; error: string | null };

@Injectable()
export class PublicationService {
  constructor(
    @InjectRepository(PublicationEntity) private readonly publications: Repository<PublicationEntity>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  async publish(userId: string, dto: PublishPageDto) {
    const pageId = this.cleanSegment(dto.pageId, 'pagina');
    const slug = this.cleanSegment(dto.slug || dto.pageName, 'pagina');
    const userPrefix = this.cleanSegment(userId.slice(0, 8), 'user');
    const siteKey = await this.uniqueSiteKey(`${userPrefix}-${slug}`, userId, pageId);
    const targetDirectory = this.resolveSiteDirectory(siteKey);
    const customDomain = this.normalizeDomain(dto.customDomain || '');

    if (Buffer.byteLength(dto.html, 'utf8') > publicationLimits.maxHtmlBytes) {
      throw new BadRequestException(`HTML maior que o limite de ${publicationLimits.maxHtmlBytes} bytes.`);
    }

    if (!this.looksLikeHtml(dto.html)) {
      throw new BadRequestException('Envie um HTML completo para publicação.');
    }

    let publication = await this.publications.findOneBy({ userId, pageId });
    await this.assertPublicationQuota(userId, Boolean(publication), Boolean(customDomain), publication?.customDomain || null);
    let domainCheck: DomainCheck = this.emptyDomainCheck();
    if (customDomain) {
      this.assertAllowedDomain(customDomain);
      await this.assertDomainAvailable(customDomain, publication?.id);
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
      slug,
      siteKey,
      customDomain,
      domainStatus: customDomain ? domainCheck.status : 'none',
      domainVerifiedAt: domainCheck.status === 'active' ? new Date() : null,
      domainLastCheckedAt: customDomain ? new Date() : null,
      domainVerificationError: customDomain ? domainCheck.error : null,
      publicUrl: `${publicBaseUrl}/p/${siteKey}/`,
      customDomainUrl: customDomain ? `https://${customDomain}/` : null,
      sitePath: targetDirectory,
      publishedAt: new Date()
    });
    await this.publications.save(publication);
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
    await this.notifications.create(userId, {
      title: domainCheck.status === 'active' ? 'DNS validado' : 'DNS pendente',
      message: domainCheck.status === 'active' ? `O domínio da página ${publication.pageName} está ativo.` : `O DNS da página ${publication.pageName} ainda está pendente.`,
      type: domainCheck.status === 'active' ? 'success' : 'pending',
      action: 'projects'
    });
    return this.response(publication);
  }

  async findByDomain(hostname: string) {
    const domain = this.normalizeDomain(hostname);
    if (!domain) return null;
    return this.publications.findOneBy({ customDomain: domain, domainStatus: 'active' });
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
        value: dnsCnameTarget
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
    const marker = 'data-builder-analytics="server"';
    if (html.includes(marker)) return html;

    const script = `
<script ${marker}>
(function(){
  var pageId = ${JSON.stringify(pageId)};
  var pageName = ${JSON.stringify(pageName)};
  var sessionKey = 'ab_session_' + pageId;
  var sessionId = sessionStorage.getItem(sessionKey) || (Date.now().toString(36) + Math.random().toString(36).slice(2));
  var startedAt = Date.now();
  var maxScroll = 0;
  sessionStorage.setItem(sessionKey, sessionId);
  function send(type, target, value, meta) {
    var body = JSON.stringify({
      pageId: pageId,
      pageName: pageName,
      type: type,
      target: target || '',
      value: Number(value) || 0,
      sessionId: sessionId,
      referrer: document.referrer || '',
      meta: meta || {}
    });
    try {
      fetch('/api/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function(){});
    } catch (e) {
      try {
        if (navigator.sendBeacon) navigator.sendBeacon('/api/analytics/events', new Blob([body], { type: 'application/json' }));
      } catch (_) {}
    }
  }
  send('page_view', 'page', 1);
  document.addEventListener('click', function(event) {
    var target = event.target.closest && event.target.closest('a, button, [role="button"], .canvas-btn, .canvas-pitch-btn');
    if (target) send('cta_click', target.innerText || target.getAttribute('href') || target.getAttribute('aria-label') || 'click', 1, { href: target.getAttribute('href') || '' });
  });
  document.addEventListener('submit', function(event) {
    send('form_submit', event.target.getAttribute('action') || 'form', 1);
  });
  window.addEventListener('scroll', function() {
    var doc = document.documentElement;
    var height = Math.max(1, doc.scrollHeight - window.innerHeight);
    maxScroll = Math.max(maxScroll, Math.round((window.scrollY / height) * 100));
  }, { passive: true });
  setInterval(function(){ send('time_on_page', 'page', Math.round((Date.now() - startedAt) / 1000)); startedAt = Date.now(); }, 15000);
  window.addEventListener('beforeunload', function(){ send('scroll_depth', 'page', maxScroll); send('time_on_page', 'page', Math.round((Date.now() - startedAt) / 1000)); });
  function bindVideos() {
    document.querySelectorAll('video').forEach(function(video, index) {
      if (video.dataset.builderAnalyticsBound) return;
      video.dataset.builderAnalyticsBound = '1';
      var target = video.getAttribute('id') || video.getAttribute('src') || ('video-' + (index + 1));
      var last = 0;
      video.addEventListener('play', function(){ send('video_play', target, Math.round(video.currentTime || 0)); });
      video.addEventListener('timeupdate', function(){
        var now = Math.round(video.currentTime || 0);
        if (now - last >= 5) { last = now; send('video_progress', target, 5, { currentTime: now, duration: Math.round(video.duration || 0) }); }
      });
      video.addEventListener('ended', function(){ send('video_complete', target, Math.round(video.duration || video.currentTime || 0)); });
    });
    document.querySelectorAll('vturb-smartplayer, .canvas-vturb-wrapper').forEach(function(player, index) {
      if (player.dataset.builderAnalyticsBound) return;
      player.dataset.builderAnalyticsBound = '1';
      var smart = player.matches && player.matches('vturb-smartplayer') ? player : player.querySelector('vturb-smartplayer');
      var target = (smart && smart.getAttribute('id')) || ('vturb-' + (index + 1));
      var played = false;
      var lastProgress = 0;
      function markPlay(value) {
        if (!played) {
          played = true;
          send('video_play', target, Number(value) || 0, { provider: 'vturb' });
        }
      }
      player.addEventListener('click', function(){ markPlay(0); });
      if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function(entries) {
          entries.forEach(function(entry) {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.5) markPlay(0);
          });
        }, { threshold: [0.5] });
        observer.observe(player);
      }
      setInterval(function() {
        try {
          var instances = window.smartplayer && window.smartplayer.instances ? window.smartplayer.instances : [];
          instances.forEach(function(inst) {
            var video = inst && inst.video;
            if (!video || !(video.currentTime > 0)) return;
            markPlay(video.currentTime);
            var now = Math.round(video.currentTime || 0);
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

  private async assertPublicationQuota(userId: string, updatingExisting: boolean, hasCustomDomain: boolean, previousDomain: string | null) {
    if (!updatingExisting) {
      const count = await this.publications.countBy({ userId });
      if (count >= publicationLimits.maxPublicationsPerUser) {
        throw new BadRequestException('Limite de publicações atingido para este usuário.');
      }
    }

    if (hasCustomDomain && !previousDomain) {
      const domainCount = await this.publications.countBy({ userId });
      const withDomain = await this.publications.find({ where: { userId } });
      if (domainCount && withDomain.filter(item => Boolean(item.customDomain)).length >= publicationLimits.maxCustomDomainsPerUser) {
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
