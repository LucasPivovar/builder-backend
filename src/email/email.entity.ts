import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('email_contacts')
@Index(['userId', 'email'], { unique: true })
export class EmailContactEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type:'varchar', length:36 }) userId: string;
  @Column({ type:'varchar', length:255 }) email: string;
  @Column({ type:'varchar', length:160, default:'' }) name: string;
  @Column({ type:'varchar', length:20, default:'subscribed' }) status: 'subscribed'|'unsubscribed'|'bounced';
  @Column({ type:'varchar', length:80, default:'manual' }) consentSource: string;
  @Column({ type:'datetime', nullable:true }) consentAt?: Date|null;
  @Column({ type:'datetime', nullable:true }) unsubscribedAt?: Date|null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('email_campaigns')
export class EmailCampaignEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type:'varchar', length:36 }) userId: string;
  @Column({ type:'varchar', length:160 }) name: string;
  @Column({ type:'varchar', length:220 }) subject: string;
  @Column({ type:'varchar', length:160 }) fromName: string;
  @Column({ type:'varchar', length:120 }) pageId: string;
  @Column({ type:'text' }) html: string;
  @Column({ type:'varchar', length:20, default:'draft' }) status: 'draft'|'queued'|'sending'|'sent'|'failed';
  @Column({ type:'integer', default:0 }) recipients: number;
  @Column({ type:'integer', default:0 }) sent: number;
  @Column({ type:'integer', default:0 }) failed: number;
  @Column({ type:'integer', default:0 }) opened: number;
  @Column({ type:'datetime', nullable:true }) sentAt?: Date|null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('email_deliveries')
@Index(['campaignId','contactId'], { unique:true })
export class EmailDeliveryEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type:'varchar', length:36 }) campaignId: string;
  @Column({ type:'varchar', length:36 }) contactId: string;
  @Column({ type:'varchar', length:255 }) email: string;
  @Column({ type:'varchar', length:20, default:'queued' }) status: 'queued'|'sent'|'failed'|'opened'|'bounced'|'unsubscribed';
  @Column({ type:'varchar', length:255, default:'' }) providerId: string;
  @Column({ type:'varchar', length:1000, default:'' }) error: string;
  @Column({ type:'integer', default:0 }) attempts: number;
  @Column({ type:'datetime', nullable:true }) sentAt?: Date|null;
  @Column({ type:'datetime', nullable:true }) openedAt?: Date|null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
