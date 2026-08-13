import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notifications')
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 36 }) userId: string;
  @Column({ type: 'varchar', length: 120 }) title: string;
  @Column({ type: 'varchar', length: 500 }) message: string;
  @Column({ type: 'varchar', length: 30, default: 'info' }) type: string;
  @Column({ type: 'varchar', length: 40, default: '' }) action: string;
  @Column({ type: 'boolean', default: false }) read: boolean;
  @CreateDateColumn() createdAt: Date;
}
