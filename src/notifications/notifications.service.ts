import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity } from './notification.entity';

@Injectable()
export class NotificationsService {
  constructor(@InjectRepository(NotificationEntity) private readonly notifications: Repository<NotificationEntity>) {}

  async list(userId: string) {
    if (await this.notifications.count({ where: { userId } }) === 0) {
      await this.notifications.save([
        this.notifications.create({ userId, title: 'Bem-vindo ao Funil Builder', message: 'Crie sua primeira página ou escolha um template para começar.', type: 'welcome', action: 'create' }),
        this.notifications.create({ userId, title: 'Salvamento protegido', message: 'Seus projetos são sincronizados com o backend local e mantêm histórico de recuperação.', type: 'security', action: 'projects' }),
        this.notifications.create({ userId, title: 'Novos templates disponíveis', message: 'A biblioteca agora organiza modelos de VSL, funil e e-mail.', type: 'update', action: 'templates' })
      ]);
    }
    const items = await this.notifications.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 30 });
    return { unread: items.filter(item => !item.read).length, items };
  }

  async markRead(userId: string, id: string) {
    await this.notifications.update({ id, userId }, { read: true });
    return this.list(userId);
  }

  async markAllRead(userId: string) {
    await this.notifications.update({ userId, read: false }, { read: true });
    return this.list(userId);
  }
}
