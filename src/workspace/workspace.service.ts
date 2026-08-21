import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { UserEntity } from '../auth/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SaveWorkspaceDto } from './workspace.dto';
import { WorkspaceBackupEntity, WorkspaceData, WorkspaceEntity } from './workspace.entity';

@Injectable()
export class WorkspaceService {
  constructor(
    @InjectRepository(WorkspaceEntity) private readonly workspaces: Repository<WorkspaceEntity>,
    @InjectRepository(WorkspaceBackupEntity) private readonly backups: Repository<WorkspaceBackupEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  async get(userId: string) {
    let workspace = await this.workspaces.findOneBy({ userId });
    if (!workspace) {
      workspace = this.workspaces.create({
        userId,
        data: this.defaultData(),
        initialized: false,
        revision: 0
      });
      await this.workspaces.save(workspace);
    }
    return this.response(workspace);
  }

  async save(userId: string, dto: SaveWorkspaceDto) {
    let workspace = await this.workspaces.findOneBy({ userId });
    if (!workspace) {
      workspace = this.workspaces.create({ userId, data: this.defaultData(), revision: 0 });
    }

    if (dto.revision !== undefined && dto.revision !== workspace.revision) {
      throw new ConflictException({
        message: 'Os dados foram atualizados em outra sessão.',
        currentRevision: workspace.revision
      });
    }

    if (workspace.initialized) {
      await this.createBackup(workspace, 'Antes do salvamento');
    }
    workspace.data = this.sanitize({
      pages: dto.pages,
      folders: dto.folders,
      templates: dto.templates,
      versions: dto.versions,
      metrics: dto.metrics,
      settings: dto.settings || {}
    });
    workspace.initialized = true;
    workspace.revision += 1;
    await this.workspaces.save(workspace);
    const pages = Array.isArray(workspace.data?.pages) ? workspace.data.pages : [];
    const latestPage = pages
      .map((page: any) => ({ id: String(page?.id || ''), name: String(page?.name || 'Página'), updatedAt: page?.lastEditedAt || page?.updatedAt || page?.createdAt || '' }))
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())[0];
    const pageName = latestPage?.name || 'Workspace';
    await this.notifications.create(userId, {
      title: 'Página salva',
      message: `Sua página ${pageName} foi salva com sucesso.`,
      type: 'success',
      action: 'projects'
    });
    await this.audit.record({
      userId,
      type: 'success',
      title: 'Página salva',
      message: `A página ${pageName} do usuário ${userId} foi salva.`,
      pageId: latestPage?.id,
      pageName
    });
    return this.response(workspace);
  }

  async getByUserId(userId: string) {
    return this.get(userId);
  }

  async listBackups(userId: string) {
    return this.backups.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 20 });
  }

  async platformTemplates() {
    const admins = await this.users.find({ where: { role: 'admin', active: true } });
    if (!admins.length) return [];
    const workspaces = await this.workspaces.find();
    const adminIds = new Set(admins.map(user => user.id));
    return workspaces
      .filter(workspace => adminIds.has(workspace.userId))
      .flatMap(workspace => Array.isArray(workspace.data?.templates) ? workspace.data.templates : [])
      .map((template: any) => ({
        ...template,
        id: template?.id ? `platform-${template.id}` : `platform-${Date.now()}`,
        sourceTemplateId: template?.id || '',
        platformTemplate: true
      }));
  }

  async restoreBackup(userId: string, backupId: string) {
    const backup = await this.backups.findOneBy({ id: backupId, userId });
    if (!backup) return null;
    let workspace = await this.workspaces.findOneBy({ userId });
    if (!workspace) workspace = this.workspaces.create({ userId, data: this.defaultData(), revision: 0 });
    if (workspace.initialized) await this.createBackup(workspace, 'Antes da restauração administrativa');
    workspace.data = this.sanitize(backup.data);
    workspace.initialized = true;
    workspace.revision += 1;
    await this.workspaces.save(workspace);
    await this.audit.record({ userId, type: 'warning', title: 'Backup restaurado', message: `Backup ${backupId} restaurado por administrador.` });
    return this.response(workspace);
  }

  private async createBackup(workspace: WorkspaceEntity, reason: string) {
    await this.backups.save(this.backups.create({
      userId: workspace.userId,
      data: this.sanitize(workspace.data),
      revision: workspace.revision,
      reason
    }));
    const retained = await this.backups.find({ where: { userId: workspace.userId }, order: { createdAt: 'DESC' }, skip: 20 });
    if (retained.length) await this.backups.remove(retained);
  }

  private defaultData(): WorkspaceData {
    return {
      pages: [],
      folders: [{
        id: 'folder-default',
        name: 'Funil Principal',
        parentId: null,
        color: '#0ea5e9',
        createdAt: new Date().toISOString()
      }],
      templates: [],
      versions: [],
      metrics: [],
      settings: {}
    };
  }

  private sanitize(data: WorkspaceData): WorkspaceData {
    return JSON.parse(JSON.stringify(data, (key, value) =>
      ['__proto__', 'prototype', 'constructor'].includes(key) ? undefined : value
    )) as WorkspaceData;
  }

  private response(workspace: WorkspaceEntity) {
    return {
      revision: workspace.revision,
      initialized: workspace.initialized,
      updatedAt: workspace.updatedAt,
      data: workspace.data
    };
  }
}
