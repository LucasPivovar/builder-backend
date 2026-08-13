import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export interface WorkspaceData {
  pages: unknown[];
  folders: unknown[];
  templates: unknown[];
  versions: unknown[];
  metrics: unknown[];
  settings: Record<string, unknown>;
}

@Entity('workspaces')
export class WorkspaceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36, unique: true })
  userId: string;

  @Column({ type: 'simple-json' })
  data: WorkspaceData;

  @Column({ type: 'integer', default: 0 })
  revision: number;

  @Column({ type: 'boolean', default: false })
  initialized: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('workspace_backups')
export class WorkspaceBackupEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  userId: string;

  @Column({ type: 'simple-json' })
  data: WorkspaceData;

  @Column({ type: 'integer', default: 0 })
  revision: number;

  @Column({ type: 'varchar', length: 60, default: 'Salvamento automático' })
  reason: string;

  @CreateDateColumn()
  createdAt: Date;
}
