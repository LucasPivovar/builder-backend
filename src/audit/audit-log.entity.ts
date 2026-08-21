import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36, nullable: true }) userId: string | null;
  @Column({ type: 'varchar', length: 120, default: '' }) userEmail: string;
  @Column({ type: 'varchar', length: 40 }) type: string;
  @Column({ type: 'varchar', length: 140 }) title: string;
  @Column({ type: 'varchar', length: 700 }) message: string;
  @Column({ type: 'varchar', length: 80, default: '' }) pageId: string;
  @Column({ type: 'varchar', length: 160, default: '' }) pageName: string;
  @Column({ type: 'simple-json', nullable: true }) meta: Record<string, unknown> | null;
  @CreateDateColumn() createdAt: Date;
}
