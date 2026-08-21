import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('notification_states')
export class NotificationStateEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  userId: string;

  @Column({ type: 'datetime', nullable: true })
  clearedAt?: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
