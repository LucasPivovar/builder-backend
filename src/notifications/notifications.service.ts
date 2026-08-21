import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationStateEntity } from './notification-state.entity';
import { NotificationEntity } from './notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationEntity) private readonly notifications: Repository<NotificationEntity>,
    @InjectRepository(NotificationStateEntity) private readonly states: Repository<NotificationStateEntity>
  ) {}

  async list(userId: string) {
    await this.ensureSystemNotifications(userId);
    const items = await this.notifications.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 100 });
    return { unread: items.filter(item => !item.read).length, items };
  }

  async create(userId: string, input: { title: string; message: string; type?: string; action?: string }) {
    return this.notifications.save(this.notifications.create({
      userId,
      title: input.title.slice(0, 120),
      message: input.message.slice(0, 500),
      type: input.type || 'info',
      action: input.action || ''
    }));
  }

  async createMany(userIds: string[], input: { title: string; message: string; type?: string; action?: string }) {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    if (!uniqueUserIds.length) return [];
    return this.notifications.save(uniqueUserIds.map(userId => this.notifications.create({
      userId,
      title: input.title.slice(0, 120),
      message: input.message.slice(0, 500),
      type: input.type || 'info',
      action: input.action || ''
    })));
  }

  async markRead(userId: string, id: string) {
    await this.notifications.update({ id, userId }, { read: true });
    return this.list(userId);
  }

  async markAllRead(userId: string) {
    await this.notifications.update({ userId, read: false }, { read: true });
    return this.list(userId);
  }

  async clear(userId: string) {
    await this.notifications.delete({ userId });
    await this.states.save(this.states.create({ userId, clearedAt: new Date() }));
    return { unread: 0, items: [] };
  }

  private async ensureSystemNotifications(userId: string) {
    const systemItems = [
      { title: 'Bem-vindo ao Funil Builder', message: 'Crie sua primeira página ou escolha um template para começar.', type: 'welcome', action: 'create', releaseAt: '2026-08-20T00:00:00.000Z' },
      { title: 'Salvamento protegido', message: 'Seus projetos são sincronizados com o backend local e mantêm histórico de recuperação.', type: 'security', action: 'projects', releaseAt: '2026-08-20T00:00:00.000Z' },
      { title: 'Publicação no servidor disponível', message: 'Agora você pode publicar páginas em /p/... e abrir a URL publicada direto pelo dashboard.', type: 'success', action: 'projects', releaseAt: '2026-08-21T20:00:00.000Z' },
      { title: 'Métricas por página adicionadas', message: 'Cada página publicada ganhou dashboard exclusivo com visualizações, cliques, scroll, tempo médio e vídeo.', type: 'update', action: 'projects', releaseAt: '2026-08-21T20:00:00.000Z' },
      { title: 'Rastreio automático ativado', message: 'O backend injeta o script de rastreio no head das páginas publicadas e atualiza páginas antigas ao subir.', type: 'security', action: 'projects', releaseAt: '2026-08-21T20:00:00.000Z' },
      { title: 'DNS customizado preparado', message: 'O modal de DNS mostra instruções de CNAME/A e valida quando o domínio aponta para o servidor.', type: 'pending', action: 'projects', releaseAt: '2026-08-21T20:00:00.000Z' },
      { title: 'Organização por pastas melhorada', message: 'As páginas agora aparecem em colunas por pasta, com ações para abrir, publicar, DNS e métricas.', type: 'update', action: 'projects', releaseAt: '2026-08-21T20:00:00.000Z' },
      { title: 'Notificações podem ser limpas', message: 'O painel de notificações agora tem botão para limpar todas as mensagens da sua conta.', type: 'info', action: 'projects', releaseAt: '2026-08-21T20:00:00.000Z' }
    ];
    const state = await this.states.findOne({ where: { userId } });
    const clearedAt = state?.clearedAt ? new Date(state.clearedAt).getTime() : 0;
    const existing = await this.notifications.find({ where: { userId } });
    const titles = new Set(existing.map(item => item.title));
    const missing = systemItems.filter(item => new Date(item.releaseAt).getTime() > clearedAt && !titles.has(item.title));
    if (!missing.length) return;
    await this.notifications.save(missing.map(({ releaseAt, ...item }) => this.notifications.create({ userId, ...item })));
  }
}
