import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { createHash } from 'crypto';
import { rm, unlink } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { DataSource, In } from 'typeorm';
import { AnalyticsEventEntity } from '../analytics/analytics-event.entity';
import { PopupSubmissionEntity } from '../analytics/popup-submission.entity';
import { HostedAssetEntity } from '../assets/hosted-asset.entity';
import { AuditLogEntity } from '../audit/audit-log.entity';
import { AuthSessionEntity } from '../auth/auth-session.entity';
import { PasswordResetEntity } from '../auth/password-reset.entity';
import { UserEntity } from '../auth/user.entity';
import { EmailVerificationEntity } from '../auth/email-verification.entity';
import { PlanChangeRequestEntity, SubscriptionEntity } from '../billing/subscription.entity';
import { dataDirectory, hostedAssetsDirectory, hostedVideosDirectory, publishedSitesDirectory, supportAttachmentsDirectory } from '../config/local-config';
import { EmailCampaignEntity, EmailContactEntity, EmailDeliveryEntity } from '../email/email.entity';
import { NotificationEntity } from '../notifications/notification.entity';
import { NotificationStateEntity } from '../notifications/notification-state.entity';
import { PublicationEntity } from '../publications/publication.entity';
import { SupportTicketEntity } from '../support/support-ticket.entity';
import { HostedVideoEntity } from '../videos/hosted-video.entity';
import { WorkspaceBackupEntity, WorkspaceEntity } from '../workspace/workspace.entity';
import { WebhookDeliveryEntity } from '../analytics/webhook-delivery.entity';

@Injectable()
export class PrivacyService {
  constructor(private readonly db: DataSource) {}

  async export(userId: string) {
    const user = await this.db.getRepository(UserEntity).findOneBy({ id: userId });
    if (!user) throw new UnauthorizedException();
    const workspace = await this.db.getRepository(WorkspaceEntity).findOneBy({ userId });
    const pageIds = ((workspace?.data?.pages || []) as any[]).map(page => String(page.id));
    const [backups, publications, events, leads, notifications, audit, support, videos, assets, subscription, planRequests, contacts, campaigns, sessions, webhooks] = await Promise.all([
      this.db.getRepository(WorkspaceBackupEntity).find({ where: { userId } }),
      this.db.getRepository(PublicationEntity).find({ where: { userId } }),
      pageIds.length ? this.db.getRepository(AnalyticsEventEntity).find({ where: { pageId: In(pageIds) } }) : [],
      this.db.getRepository(PopupSubmissionEntity).find({ where: { userId } }),
      this.db.getRepository(NotificationEntity).find({ where: { userId } }),
      this.db.getRepository(AuditLogEntity).find({ where: { userId } }),
      this.db.getRepository(SupportTicketEntity).find({ where: { userId } }),
      this.db.getRepository(HostedVideoEntity).find({ where: { userId } }),
      this.db.getRepository(HostedAssetEntity).find({ where: { userId } }),
      this.db.getRepository(SubscriptionEntity).findOneBy({ userId }),
      this.db.getRepository(PlanChangeRequestEntity).find({ where: { userId } }),
      this.db.getRepository(EmailContactEntity).find({ where: { userId } }),
      this.db.getRepository(EmailCampaignEntity).find({ where: { userId } }),
      this.db.getRepository(AuthSessionEntity).find({ where: { userId } }),
      this.db.getRepository(WebhookDeliveryEntity).find({ where: { userId } })
    ]);
    const deliveries = campaigns.length
      ? await this.db.getRepository(EmailDeliveryEntity).find({ where: { campaignId: In(campaigns.map(row => row.id)) } })
      : [];
    return {
      exportedAt: new Date().toISOString(),
      profile: { id:user.id, name:user.name, lastName:user.lastName, email:user.email, phone:user.phone, role:user.role, createdAt:user.createdAt, updatedAt:user.updatedAt },
      workspace, backups, publications, analytics: events, leads, notifications, audit, support, videos, assets,
      billing: { subscription, requests: planRequests }, email: { contacts, campaigns, deliveries }, sessions, webhookDeliveries: webhooks
    };
  }

  async deleteAccount(userId: string, password: string) {
    const users = this.db.getRepository(UserEntity);
    const user = await users.createQueryBuilder('user').addSelect('user.passwordHash').where('user.id = :userId', { userId }).getOne();
    if (!user || !await compare(password, user.passwordHash)) throw new BadRequestException('Senha incorreta.');
    if (user.role === 'admin' && user.active && await users.count({ where: { role:'admin', active:true } }) <= 1) throw new BadRequestException('Transfira a administração antes de excluir o último administrador.');
    const [publications, videos, assets, tickets, campaigns, contacts, workspace] = await Promise.all([
      this.db.getRepository(PublicationEntity).find({ where: { userId } }),
      this.db.getRepository(HostedVideoEntity).find({ where: { userId } }),
      this.db.getRepository(HostedAssetEntity).find({ where: { userId } }),
      this.db.getRepository(SupportTicketEntity).find({ where: { userId } }),
      this.db.getRepository(EmailCampaignEntity).find({ where: { userId } }),
      this.db.getRepository(EmailContactEntity).find({ where: { userId } }),
      this.db.getRepository(WorkspaceEntity).findOneBy({ userId })
    ]);
    const pageIds = ((workspace?.data?.pages || []) as any[]).map(page => String(page.id));
    await this.db.transaction(async manager => {
      if (campaigns.length) await manager.delete(EmailDeliveryEntity, { campaignId: In(campaigns.map(row => row.id)) });
      else if (contacts.length) await manager.delete(EmailDeliveryEntity, { contactId: In(contacts.map(row => row.id)) });
      await manager.delete(EmailCampaignEntity, { userId }); await manager.delete(EmailContactEntity, { userId });
      await manager.delete(PlanChangeRequestEntity, { userId }); await manager.delete(SubscriptionEntity, { userId });
      await manager.delete(HostedAssetEntity, { userId }); await manager.delete(HostedVideoEntity, { userId }); await manager.delete(SupportTicketEntity, { userId });
      await manager.delete(AuditLogEntity, { userId }); await manager.delete(NotificationStateEntity, { userId }); await manager.delete(NotificationEntity, { userId });
      await manager.delete(PopupSubmissionEntity, { userId }); if (pageIds.length) await manager.delete(AnalyticsEventEntity, { pageId: In(pageIds) });
      await manager.delete(WebhookDeliveryEntity, { userId });
      await manager.delete(PublicationEntity, { userId }); await manager.delete(WorkspaceBackupEntity, { userId }); await manager.delete(WorkspaceEntity, { userId });
      await manager.delete(PasswordResetEntity, { userId }); await manager.delete(EmailVerificationEntity, { userId }); await manager.delete(AuthSessionEntity, { userId }); await manager.delete(UserEntity, { id:userId });
    });
    for (const publication of publications) { const path=resolve(publication.sitePath); if (path.startsWith(resolve(publishedSitesDirectory)+sep)) await rm(path,{recursive:true,force:true}); }
    for (const row of videos) await unlink(join(hostedVideosDirectory,row.storageName)).catch(()=>undefined);
    for (const row of assets) await unlink(join(hostedAssetsDirectory,row.storageName)).catch(()=>undefined);
    for (const ticket of tickets) for (const attachment of ticket.attachments||[]) await unlink(join(supportAttachmentsDirectory,attachment.storageName)).catch(()=>undefined);
    await rm(join(dataDirectory,'private-projects',createHash('sha256').update(userId).digest('hex')),{recursive:true,force:true});
    return { ok:true };
  }
}
