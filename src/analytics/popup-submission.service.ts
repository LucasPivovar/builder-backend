import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { PublicationEntity } from '../publications/publication.entity';
import { PopupSubmissionEntity } from './popup-submission.entity';
import { PopupSubmissionDto } from './popup-submission.dto';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { validAnalyticsSignature } from '../config/analytics-signature';
import { WebhookDeliveryEntity } from './webhook-delivery.entity';

@Injectable()
export class PopupSubmissionService implements OnModuleInit {
  constructor(
    @InjectRepository(PopupSubmissionEntity) private readonly submissions: Repository<PopupSubmissionEntity>,
    @InjectRepository(PublicationEntity) private readonly publications: Repository<PublicationEntity>,
    @InjectRepository(WorkspaceEntity) private readonly workspaces: Repository<WorkspaceEntity>,
    @InjectRepository(WebhookDeliveryEntity) private readonly webhookDeliveries: Repository<WebhookDeliveryEntity>
  ) {}
  onModuleInit(){const timer=setInterval(()=>this.processQueue().catch(()=>undefined),30_000);timer.unref();void this.processQueue();}
  async submit(dto: PopupSubmissionDto) {
    const publication = await this.publications.findOneBy({ pageId: dto.pageId });
    if (!publication) throw new NotFoundException('Página não publicada.');
    if (!validAnalyticsSignature(dto.pageId,dto.signature)) throw new BadRequestException('Assinatura de analytics inválida.');
    if (dto.visitorId && await this.submissions.findOneBy({ pageId: dto.pageId, popupId: dto.popupId, visitorId: dto.visitorId })) return { ok: true };
    const row = await this.submissions.save(this.submissions.create({ ...dto, userId: publication.userId }));
    const workspace = await this.workspaces.findOneBy({ userId: publication.userId });
    const page: any = workspace?.data.pages.find((page: any) => page.id === dto.pageId);
    const popup = (page?.rows || []).flatMap((row: any) => (row.columns || []).flatMap((col: any) => col.elements || [])).find((element: any) => element.id === dto.popupId);
    if (popup?.webhook?.url) {
      this.assertWebhookUrl(popup.webhook.url);
      const payload: Record<string, unknown> = { gateway: 'Astro Builder', external_id: row.id };
      for (const key of ['name', 'email', 'phone']) { const field = dto.fields.find(field => field.id === popup.webhook[key]); if (field) payload[key] = field.value; }
      row.webhookStatus = 'queued';
      await this.submissions.save(row);
      await this.webhookDeliveries.save(this.webhookDeliveries.create({userId:publication.userId,submissionId:row.id,url:popup.webhook.url,payload,status:'queued',nextAttemptAt:new Date()}));
      void this.processQueue();
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
  async listWebhooks(userId:string,page=1){const take=25;const [items,total]=await this.webhookDeliveries.findAndCount({where:{userId},order:{createdAt:'DESC'},skip:(page-1)*take,take});return{items:items.map(({url,payload,...item})=>({...item,target:new URL(url).hostname})),total,page,pageSize:take};}
  private processing=false;
  private async processQueue(){if(this.processing)return;this.processing=true;try{const rows=await this.webhookDeliveries.find({where:{status:In(['queued','failed']),nextAttemptAt:LessThanOrEqual(new Date())},order:{createdAt:'ASC'},take:20});for(const delivery of rows){delivery.attempts+=1;try{this.assertWebhookUrl(delivery.url);const response=await fetch(delivery.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(delivery.payload),redirect:'error',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);delivery.status='sent';delivery.sentAt=new Date();delivery.error='';await this.submissions.update(delivery.submissionId,{webhookStatus:'sent'});}catch(error){delivery.status='failed';delivery.error=String((error as Error).message||error).slice(0,1000);delivery.nextAttemptAt=new Date(Date.now()+Math.min(24*60,2**delivery.attempts)*60_000);if(delivery.attempts>=8)delivery.nextAttemptAt=new Date(Date.now()+24*60*60_000);await this.submissions.update(delivery.submissionId,{webhookStatus:'failed'});}await this.webhookDeliveries.save(delivery);}}finally{this.processing=false;}}
  private assertWebhookUrl(input:string){let url:URL;try{url=new URL(input);}catch{throw new BadRequestException('Webhook Sellflux inválido.');}if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!['sellflux.com','sellflux.com.br'].some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain)))throw new BadRequestException('Webhook Sellflux inválido.');}
}
