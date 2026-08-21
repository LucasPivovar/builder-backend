import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('analytics_events')
export class AnalyticsEventEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index()
  @Column({ type: 'varchar', length: 36, nullable: true }) userId: string | null;
  @Index()
  @Column({ type: 'varchar', length: 120 }) pageId: string;
  @Column({ type: 'varchar', length: 160, default: '' }) pageName: string;
  @Index()
  @Column({ type: 'varchar', length: 40 }) type: string;
  @Column({ type: 'varchar', length: 220, default: '' }) target: string;
  @Column({ type: 'integer', default: 0 }) value: number;
  @Column({ type: 'varchar', length: 80, default: '' }) sessionId: string;
  @Column({ type: 'varchar', length: 500, default: '' }) userAgent: string;
  @Column({ type: 'varchar', length: 120, default: '' }) referrer: string;
  @Column({ type: 'simple-json', nullable: true }) meta: Record<string, unknown> | null;
  @CreateDateColumn() createdAt: Date;
}
