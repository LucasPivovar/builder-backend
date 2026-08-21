import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('publications')
export class PublicationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  userId: string;

  @Column({ type: 'varchar', length: 80 })
  pageId: string;

  @Column({ type: 'varchar', length: 120 })
  pageName: string;

  @Column({ type: 'varchar', length: 80 })
  slug: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  siteKey: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  customDomain?: string | null;

  @Column({ type: 'varchar', length: 20, default: 'none' })
  domainStatus: 'none' | 'pending' | 'active';

  @Column({ type: 'datetime', nullable: true })
  domainVerifiedAt?: Date | null;

  @Column({ type: 'datetime', nullable: true })
  domainLastCheckedAt?: Date | null;

  @Column({ type: 'varchar', length: 240, nullable: true })
  domainVerificationError?: string | null;

  @Column({ type: 'varchar', length: 400 })
  publicUrl: string;

  @Column({ type: 'varchar', length: 400, nullable: true })
  customDomainUrl?: string | null;

  @Column({ type: 'varchar', length: 400 })
  sitePath: string;

  @Column({ type: 'datetime' })
  publishedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
