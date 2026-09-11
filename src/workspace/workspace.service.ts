import { BadRequestException, ConflictException, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { UserEntity } from '../auth/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SaveWorkspaceDto } from './workspace.dto';
import { WorkspaceBackupEntity, WorkspaceData, WorkspaceEntity } from './workspace.entity';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { dataDirectory } from '../config/local-config';
import { encryptPrivateData } from '../config/private-data';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class WorkspaceService implements OnModuleInit {
  constructor(
    @InjectRepository(WorkspaceEntity) private readonly workspaces: Repository<WorkspaceEntity>,
    @InjectRepository(WorkspaceBackupEntity) private readonly backups: Repository<WorkspaceBackupEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly billing: BillingService
  ) {}

  async onModuleInit() {
    // Regrava também os registros legados através do transformador criptografado.
    // Registros ilegíveis são apenas relatados: a inicialização nunca pode falhar por causa deles.
    try {
      const workspaces = await this.workspaces.find();
      const backups = await this.backups.find();
      const unreadable: string[] = [];
      for (const workspace of workspaces) {
        if (workspace.data == null) { unreadable.push(`workspace ${workspace.id}`); continue; }
        await this.workspaces.update(workspace.id, { data: workspace.data as any });
      }
      for (const backup of backups) {
        if (backup.data == null) { unreadable.push(`backup ${backup.id}`); continue; }
        await this.backups.update(backup.id, { data: backup.data as any });
      }
      if (unreadable.length) {
        console.error(`[workspace] ${unreadable.length} registro(s) ilegível(is) preservado(s) sem regravação: ${unreadable.join(', ')}`);
      }
    } catch (error) {
      console.error('[workspace] falha ao regravar registros legados:', (error as Error).message);
    }
  }

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
    if (workspace.data == null) {
      throw new ServiceUnavailableException('Não foi possível ler seu workspace no servidor. Nenhum dado foi alterado — contate o suporte.');
    }
    if (workspace.data.folders.some((folder: any) => folder.id === 'folder-default' && folder.name === 'Funil Principal')) {
      workspace.data.folders = workspace.data.folders.filter((folder: any) => folder.id !== 'folder-default');
      workspace.data.pages.forEach((page: any) => { if (page.folderId === 'folder-default') page.folderId = null; });
      workspace.data.folders.forEach((folder: any) => { if (folder.parentId === 'folder-default') folder.parentId = null; });
      workspace.revision += 1;
      await this.workspaces.save(workspace);
    }
    return this.response(workspace);
  }

  async save(userId: string, dto: SaveWorkspaceDto) {
    this.assertWorkspaceStructure(dto);
    const limits = await this.billing.limits(userId);
    if (dto.pages.length > limits.maxPages) {
      throw new ConflictException(`Seu plano permite no máximo ${limits.maxPages} páginas.`);
    }
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

    if (workspace.initialized && workspace.data != null) {
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
    const opaque = (value: string) => createHash('sha256').update(value).digest('hex');
    for (const page of workspace.data.pages as any[]) {
      const directory = join(dataDirectory, 'private-projects', opaque(userId), ...(page.folderId ? [opaque(String(page.folderId))] : []));
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, opaque(String(page.id)) + '.enc'), encryptPrivateData(page), { mode: 0o600 });
    }
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

  async backupSummaries(userId: string) {
    const backups = await this.listBackups(userId);
    return backups.map(backup => ({ id: backup.id, revision: backup.revision, reason: backup.reason, createdAt: backup.createdAt, pagesCount: backup.data?.pages?.length || 0, foldersCount: backup.data?.folders?.length || 0 }));
  }

  async backupDiff(userId: string, backupId: string) {
    const [backup, workspace] = await Promise.all([this.backups.findOneBy({ id: backupId, userId }), this.workspaces.findOneBy({ userId })]);
    if (!backup) throw new ConflictException('Backup não encontrado.');
    const summarize = (items: any[] = []) => new Map(items.map(item => [String(item?.id || ''), item]));
    const compare = (beforeItems: any[] = [], currentItems: any[] = []) => {
      const before = summarize(beforeItems), current = summarize(currentItems);
      const label = (item: any) => String(item?.name || item?.label || item?.id || 'Item');
      return {
        added: [...current].filter(([id]) => !before.has(id)).map(([, item]) => label(item)),
        removed: [...before].filter(([id]) => !current.has(id)).map(([, item]) => label(item)),
        changed: [...current].filter(([id, item]) => before.has(id) && JSON.stringify(before.get(id)) !== JSON.stringify(item)).map(([, item]) => label(item))
      };
    };
    return { backup: { id: backup.id, revision: backup.revision, reason: backup.reason, createdAt: backup.createdAt }, pages: compare(backup.data?.pages, workspace?.data?.pages), folders: compare(backup.data?.folders, workspace?.data?.folders), templates: compare(backup.data?.templates, workspace?.data?.templates) };
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

  async restoreBackup(userId: string, backupId: string, backupReason = 'Antes da restauração administrativa', actor = 'administrador') {
    const backup = await this.backups.findOneBy({ id: backupId, userId });
    if (!backup) return null;
    let workspace = await this.workspaces.findOneBy({ userId });
    if (!workspace) workspace = this.workspaces.create({ userId, data: this.defaultData(), revision: 0 });
    if (backup.data == null) throw new ConflictException('Este backup não pôde ser lido e não pode ser restaurado.');
    if (workspace.initialized && workspace.data != null) await this.createBackup(workspace, backupReason);
    workspace.data = this.sanitize(backup.data);
    workspace.initialized = true;
    workspace.revision += 1;
    await this.workspaces.save(workspace);
    await this.audit.record({ userId, type: 'warning', title: 'Backup restaurado', message: `Backup ${backupId} restaurado por ${actor}.` });
    await this.notifications.create(userId, { title: 'Backup restaurado', message: 'Uma versão anterior do workspace foi restaurada.', type: 'warning', action: 'projects' });
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
      folders: [],
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

  private assertWorkspaceStructure(dto: SaveWorkspaceDto) {
    if (Buffer.byteLength(JSON.stringify(dto), 'utf8') > 4_800_000) throw new BadRequestException('Workspace maior que o limite permitido.');
    const object = (value: unknown, label: string) => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(`${label} inválido.`); return value as Record<string, any>; };
    const ids = (items: unknown[], label: string) => { const seen=new Set<string>(); return items.map((item,index)=>{const row=object(item,`${label} ${index+1}`);if(typeof row.id!=='string'||!row.id.trim()||row.id.length>120)throw new BadRequestException(`${label} sem identificador válido.`);if(seen.has(row.id))throw new BadRequestException(`Identificador duplicado em ${label}.`);seen.add(row.id);return row;}); };
    const pages=ids(dto.pages,'página');
    const folders=ids(dto.folders,'pasta');
    for(const page of pages){if(page.name!==undefined&&(typeof page.name!=='string'||page.name.length>160))throw new BadRequestException('Nome de página inválido.');if(!Array.isArray(page.rows)||page.rows.length>500)throw new BadRequestException('Estrutura de linhas da página inválida.');let elementCount=0;for(const rowValue of page.rows){const row=object(rowValue,'linha');if(typeof row.id!=='string'||row.id.length>120||!Array.isArray(row.columns)||row.columns.length>12)throw new BadRequestException('Linha da página inválida.');for(const columnValue of row.columns){const column=object(columnValue,'coluna');if(!Array.isArray(column.elements)||column.elements.length>300)throw new BadRequestException('Coluna da página inválida.');for(const elementValue of column.elements){const element=object(elementValue,'elemento');if(typeof element.id!=='string'||!element.id||element.id.length>120||typeof element.type!=='string'||!element.type||element.type.length>80)throw new BadRequestException('Elemento da página inválido.');elementCount++;}}}if(elementCount>5000)throw new BadRequestException('Página excede o limite de elementos.');}
    const folderIds=new Set(folders.map(folder=>folder.id));for(const folder of folders){if(typeof folder.name!=='string'||!folder.name.trim()||folder.name.length>160)throw new BadRequestException('Nome de pasta inválido.');if(folder.parentId!=null&&!folderIds.has(folder.parentId))throw new BadRequestException('Pasta pai inválida.');let cursor=folder.parentId;const visited=new Set([folder.id]);while(cursor){if(visited.has(cursor))throw new BadRequestException('Ciclo detectado na hierarquia de pastas.');visited.add(cursor);cursor=folders.find(item=>item.id===cursor)?.parentId;}}
    for(const [label,items] of [['template',dto.templates],['versão',dto.versions],['métrica',dto.metrics]] as const)for(const item of items){object(item,label);if(Buffer.byteLength(JSON.stringify(item),'utf8')>500_000)throw new BadRequestException(`${label} excede o tamanho permitido.`);}
    const settings=dto.settings||{};for(const key of Object.keys(settings))if(!['activeThemeKey','productTourSeen'].includes(key))throw new BadRequestException('Configuração de workspace não reconhecida.');if(settings.activeThemeKey!==undefined&&(typeof settings.activeThemeKey!=='string'||settings.activeThemeKey.length>80))throw new BadRequestException('Tema inválido.');if(settings.productTourSeen!==undefined&&typeof settings.productTourSeen!=='boolean')throw new BadRequestException('Preferência de tour inválida.');
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
