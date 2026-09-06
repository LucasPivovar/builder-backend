import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('popup_submissions')
export class PopupSubmissionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ type: 'varchar', length: 36 }) userId: string;
  @Index() @Column({ type: 'varchar', length: 120 }) pageId: string;
  @Column({ type: 'varchar', length: 120 }) popupId: string;
  @Column({ type: 'simple-json' }) fields: { id: string; label: string; value: string }[];
  @CreateDateColumn() createdAt: Date;
  @Column({ type: 'varchar', default: 'none' }) webhookStatus: string;
  @Column({ type: 'varchar', length: 80, nullable: true }) visitorId?: string;
}
