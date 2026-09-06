import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PublicationEntity } from '../publications/publication.entity';
import { PopupSubmissionEntity } from './popup-submission.entity';
import { PopupSubmissionDto } from './popup-submission.dto';
import { WorkspaceEntity } from '../workspace/workspace.entity';

@Injectable()
export class PopupSubmissionService {
  constructor(
    @InjectRepository(PopupSubmissionEntity) private readonly submissions: Repository<PopupSubmissionEntity>,
    @InjectRepository(PublicationEntity) private readonly publications: Repository<PublicationEntity>,
    @InjectRepository(WorkspaceEntity) private readonly workspaces: Repository<WorkspaceEntity>
  ) {}
  async submit(dto: PopupSubmissionDto) {
    const publication = await this.publications.findOneBy({ pageId: dto.pageId });
    if (!publication) throw new NotFoundException('Página não publicada.');
    if (dto.visitorId && await this.submissions.findOneBy({ pageId: dto.pageId, popupId: dto.popupId, visitorId: dto.visitorId })) return { ok: true };
    const row = await this.submissions.save(this.submissions.create({ ...dto, userId: publication.userId }));
    const workspace = await this.workspaces.findOneBy({ userId: publication.userId });
    const page: any = workspace?.data.pages.find((page: any) => page.id === dto.pageId);
    const popup = (page?.rows || []).flatMap((row: any) => (row.columns || []).flatMap((col: any) => col.elements || [])).find((element: any) => element.id === dto.popupId);
    if (popup?.webhook?.url) {
      row.webhookStatus = 'failed';
      try {
        const url = new URL(popup.webhook.url);
        if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !['sellflux.com', 'sellflux.com.br'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) throw new Error('Webhook Sellflux inválido');
        const payload: Record<string, unknown> = { gateway: 'Astro Builder', external_id: row.id };
        for (const key of ['name', 'email', 'phone']) {
          const field = dto.fields.find(field => field.id === popup.webhook[key]);
          if (field) payload[key] = field.value;
        }
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(8000) });
        if (response.ok) row.webhookStatus = 'sent';
      } catch (_) { /* A resposta permanece salva mesmo quando a integração falha. */ }
      await this.submissions.save(row);
    }
    return { ok: true };
  }
  async list(userId: string, pageId: string, page: number) {
    const [items, total] = await this.submissions.findAndCount({ where: { userId, pageId }, order: { createdAt: 'DESC', id: 'DESC' }, skip: (page - 1) * 5, take: 5 });
    return { items, total, page, pageSize: 5 };
  }
  async export(userId: string, pageId: string) {
    const rows = await this.submissions.find({ where: { userId, pageId }, order: { createdAt: 'DESC', id: 'DESC' } });
    const cell = (value: string) => '"' + (/^[\s]*[=+@-]/.test(value) ? "'" + value : value).replace(/"/g, '""') + '"';
    // One column per stable field id preserves repeated labels and changed forms.
    const fields = new Map<string, string>();
    rows.forEach(row => row.fields.forEach(field => fields.set(row.popupId + ':' + field.id, field.label)));
    const keys = [...fields.keys()];
    const lines = [['Data', 'Popup', ...keys.map(key => `${fields.get(key)} (${key})`)]];
    rows.forEach(row => {
      const values = new Map(row.fields.map(field => [row.popupId + ':' + field.id, field.value]));
      lines.push([row.createdAt.toISOString(), row.popupId, ...keys.map(key => values.get(key) || '')]);
    });
    return '\uFEFF' + lines.map(line => line.map(cell).join(';')).join('\r\n');
  }
}
