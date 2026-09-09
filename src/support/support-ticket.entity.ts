import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('support_tickets')
export class SupportTicketEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) userId: string;
  @Column({ type: 'varchar', length: 140 }) subject: string;
  @Column({ type: 'varchar', length: 40 }) category: string;
  @Column({ type: 'varchar', length: 20 }) priority: string;
  @Column({ type: 'varchar', length: 500, default: '' }) pageUrl: string;
  @Column({ type: 'text' }) message: string;
  @Column({ type: 'varchar', length: 20, default: 'open' }) status: 'open' | 'resolved';
  @Column({ type: 'text', default: '' }) adminReply: string;
  @Column({ type: 'simple-json', nullable: true }) messages?: { author: 'user' | 'admin'; message: string; createdAt: string }[] | null;
  @Column({ type: 'simple-json', nullable: true }) attachments?: { id: string; name: string; mimeType: string; size: number; storageName: string; createdAt: string }[] | null;
  @Column({ type: 'datetime', nullable: true }) repliedAt?: Date | null;
  @Column({ type: 'datetime', nullable: true }) resolvedAt?: Date | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
