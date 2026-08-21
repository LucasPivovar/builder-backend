import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity } from './notification.entity';

@Injectable()
export class NotificationsService {
  constructor(@InjectRepository(NotificationEntity) private readonly notifications: Repository<NotificationEntity>) {}

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
    return { unread: 0, items: [] };
  }

  private async ensureSystemNotifications(userId: string) {
    const systemItems = [
      { title: 'Bem-vindo ao Funil Builder', message: 'Crie sua primeira página ou escolha um template para começar.', type: 'welcome', action: 'create' },
      { title: 'Salvamento protegido', message: 'Seus projetos são sincronizados com o backend local e mantêm histórico de recuperação.', type: 'security', action: 'projects' },
      { title: 'Publicação no servidor disponível', message: 'Agora você pode publicar páginas em /p/... e abrir a URL publicada direto pelo dashboard.', type: 'success', action: 'projects' },
      { title: 'Métricas por página adicionadas', message: 'Cada página publicada ganhou dashboard exclusivo com visualizações, cliques, scroll, tempo médio e vídeo.', type: 'update', action: 'projects' },
      { title: 'Rastreio automático ativado', message: 'O backend injeta o script de rastreio no head das páginas publicadas e atualiza páginas antigas ao subir.', type: 'security', action: 'projects' },
      { title: 'DNS customizado preparado', message: 'O modal de DNS mostra instruções de CNAME/A e valida quando o domínio aponta para o servidor.', type: 'pending', action: 'projects' },
      { title: 'Organização por pastas melhorada', message: 'As páginas agora aparecem em colunas por pasta, com ações para abrir, publicar, DNS e métricas.', type: 'update', action: 'projects' },
      { title: 'Notificações podem ser limpas', message: 'O painel de notificações agora tem botão para limpar todas as mensagens da sua conta.', type: 'info', action: 'projects' }
    ];
    const existing = await this.notifications.find({ where: { userId } });
    const titles = new Set(existing.map(item => item.title));
    const missing = systemItems.filter(item => !titles.has(item.title));
    if (!missing.length) return;
    await this.notifications.save(missing.map(item => this.notifications.create({ userId, ...item })));
  }
}
