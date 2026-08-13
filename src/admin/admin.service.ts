import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../auth/user.entity';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { WorkspaceService } from '../workspace/workspace.service';

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(WorkspaceEntity) private readonly workspaces: Repository<WorkspaceEntity>,
    private readonly workspaceService: WorkspaceService
  ) {}

  async onModuleInit() {
    if (await this.users.exists({ where: { role: 'admin' } })) return;
    const [firstUser] = await this.users.find({ order: { createdAt: 'ASC' }, take: 1 });
    if (firstUser) {
      firstUser.role = 'admin';
      await this.users.save(firstUser);
    }
  }

  async overview() {
    const users = await this.users.find({ order: { createdAt: 'DESC' } });
    const workspaces = await this.workspaces.find();
    const totals = workspaces.reduce((acc, item) => {
      acc.pages += item.data?.pages?.length || 0;
      acc.folders += item.data?.folders?.length || 0;
      acc.templates += item.data?.templates?.length || 0;
      acc.versions += item.data?.versions?.length || 0;
      return acc;
    }, { pages: 0, folders: 0, templates: 0, versions: 0 });
    const activeThisWeek = users.filter(user => Date.now() - new Date(user.updatedAt).getTime() < 7 * 86400000).length;
    return {
      users: users.length,
      activeUsers: users.filter(user => user.active).length,
      activeThisWeek,
      workspaces: workspaces.filter(item => item.initialized).length,
      ...totals,
      recentUsers: users.slice(0, 5).map(user => this.userSummary(user, workspaces.find(item => item.userId === user.id)))
    };
  }

  async listUsers() {
    const [users, workspaces] = await Promise.all([
      this.users.find({ order: { createdAt: 'DESC' } }),
      this.workspaces.find()
    ]);
    return users.map(user => this.userSummary(user, workspaces.find(item => item.userId === user.id)));
  }

  async userWorkspace(userId: string) {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const [workspace, backups] = await Promise.all([
      this.workspaceService.getByUserId(userId),
      this.workspaceService.listBackups(userId)
    ]);
    return {
      user: this.userSummary(user),
      workspace,
      backups: backups.map(item => ({
        id: item.id,
        revision: item.revision,
        reason: item.reason,
        createdAt: item.createdAt,
        pagesCount: item.data?.pages?.length || 0,
        data: item.data
      }))
    };
  }

  async restore(userId: string, backupId: string) {
    const result = await this.workspaceService.restoreBackup(userId, backupId);
    if (!result) throw new NotFoundException('Backup não encontrado.');
    return result;
  }

  private userSummary(user: UserEntity, workspace?: WorkspaceEntity) {
    return {
      id: user.id,
      name: `${user.name} ${user.lastName}`.trim(),
      email: user.email,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      workspaceUpdatedAt: workspace?.updatedAt || null,
      revision: workspace?.revision || 0,
      projects: workspace?.data?.pages?.length || 0,
      folders: workspace?.data?.folders?.length || 0,
      templates: workspace?.data?.templates?.length || 0
    };
  }
}
