import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserEntity } from '../auth/user.entity';
import { AdminUpdateSupportTicketDto, CreateSupportTicketDto } from './support-ticket.dto';
import { SupportTicketEntity } from './support-ticket.entity';
import { open, unlink } from 'fs/promises';
import { join } from 'path';
import { supportAttachmentsDirectory } from '../config/local-config';

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportTicketEntity) private readonly tickets: Repository<SupportTicketEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService
  ) {}

  list(userId: string) {
    return this.tickets.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 100 });
  }

  async create(userId: string, dto: CreateSupportTicketDto) {
    const ticket = await this.tickets.save(this.tickets.create({
      userId,
      subject: dto.subject.trim(),
      category: dto.category,
      priority: dto.priority,
      pageUrl: dto.pageUrl?.trim() || '',
      message: dto.message.trim(),
      messages: [],
      attachments: [],
      status: 'open'
    }));
    await this.audit.record({ userId, type: dto.priority === 'Urgente' ? 'warning' : 'info', title: 'Ticket de suporte aberto', message: ticket.subject, meta: { ticketId: ticket.id, category: ticket.category, priority: ticket.priority } });
    return ticket;
  }

  async resolve(userId: string, id: string) {
    const ticket = await this.tickets.findOneBy({ id, userId });
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');
    ticket.status = 'resolved';
    ticket.resolvedAt = new Date();
    await this.tickets.save(ticket);
    await this.audit.record({ userId, type: 'success', title: 'Ticket de suporte resolvido', message: ticket.subject, meta: { ticketId: ticket.id } });
    return ticket;
  }

  async addUserMessage(userId: string, id: string, messageInput: string) {
    const ticket = await this.tickets.findOneBy({ id, userId });
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');
    const message = messageInput.trim();
    ticket.messages = [...(ticket.messages || []), { author: 'user', message, createdAt: new Date().toISOString() }];
    ticket.status = 'open';
    ticket.resolvedAt = null;
    await this.tickets.save(ticket);
    await this.audit.record({ userId, type: 'info', title: 'Nova mensagem em ticket', message: ticket.subject, meta: { ticketId: ticket.id } });
    return ticket;
  }

  async addAttachment(userId: string, id: string, file: { filename: string; originalname: string; mimetype: string; size: number }) {
    if (!file) throw new BadRequestException('Selecione um anexo.');
    const path = join(supportAttachmentsDirectory, file.filename);
    const ticket = await this.tickets.findOneBy({ id, userId });
    if (!ticket) { await unlink(path).catch(() => undefined); throw new NotFoundException('Ticket não encontrado.'); }
    if (!(await this.validAttachment(path, file.mimetype))) { await unlink(path).catch(() => undefined); throw new BadRequestException('Anexo inválido. Envie PNG, JPEG, WebP ou PDF.'); }
    if ((ticket.attachments || []).length >= 10) { await unlink(path).catch(() => undefined); throw new BadRequestException('Limite de 10 anexos por ticket atingido.'); }
    const attachment = { id: file.filename.split('.')[0], name: file.originalname.slice(0, 255), mimeType: file.mimetype, size: file.size, storageName: file.filename, createdAt: new Date().toISOString() };
    ticket.attachments = [...(ticket.attachments || []), attachment];
    await this.tickets.save(ticket);
    await this.audit.record({ userId, type: 'info', title: 'Anexo enviado ao suporte', message: ticket.subject, meta: { ticketId: id, attachmentId: attachment.id } });
    return ticket;
  }

  async getAttachment(requesterId: string, ticketId: string, attachmentId: string) {
    const [ticket, requester] = await Promise.all([this.tickets.findOneBy({ id: ticketId }), this.users.findOneBy({ id: requesterId })]);
    if (!ticket || (ticket.userId !== requesterId && requester?.role !== 'admin')) throw new NotFoundException('Anexo não encontrado.');
    const attachment = (ticket.attachments || []).find(item => item.id === attachmentId);
    if (!attachment) throw new NotFoundException('Anexo não encontrado.');
    return { ...attachment, path: join(supportAttachmentsDirectory, attachment.storageName) };
  }

  async listAll() {
    const [tickets, users] = await Promise.all([
      this.tickets.find({ order: { createdAt: 'DESC' }, take: 300 }),
      this.users.find()
    ]);
    const userMap = new Map(users.map(user => [user.id, user]));
    return tickets.map(ticket => {
      const user = userMap.get(ticket.userId);
      return { ...ticket, userName: user ? `${user.name} ${user.lastName}`.trim() : 'Usuário removido', userEmail: user?.email || '' };
    });
  }

  async adminUpdate(actorId: string, id: string, dto: AdminUpdateSupportTicketDto) {
    const ticket = await this.tickets.findOneBy({ id });
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');
    const reply = dto.reply?.trim() || '';
    if (reply && reply !== ticket.adminReply) {
      ticket.adminReply = reply;
      ticket.repliedAt = new Date();
      ticket.messages = [...(ticket.messages || []), { author: 'admin', message: reply, createdAt: ticket.repliedAt.toISOString() }];
    }
    ticket.status = dto.status;
    ticket.resolvedAt = dto.status === 'resolved' ? new Date() : null;
    await this.tickets.save(ticket);
    await this.notifications.create(ticket.userId, {
      title: reply ? 'Nova resposta do suporte' : dto.status === 'resolved' ? 'Ticket resolvido' : 'Ticket reaberto',
      message: reply || `Seu ticket “${ticket.subject}” foi ${dto.status === 'resolved' ? 'resolvido' : 'reaberto'}.`,
      type: dto.status === 'resolved' ? 'success' : 'info',
      action: 'support'
    });
    await this.audit.record({ userId: ticket.userId, type: dto.status === 'resolved' ? 'success' : 'info', title: 'Ticket atualizado pelo suporte', message: ticket.subject, meta: { ticketId: id, actorId, status: dto.status, replied: Boolean(reply) } });
    return ticket;
  }

  private async validAttachment(path: string, mime: string) {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(12); const { bytesRead } = await handle.read(buffer, 0, 12, 0);
      if (bytesRead < 4) return false;
      if (mime === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
      if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      if (mime === 'image/jpeg') return buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
      if (mime === 'image/webp') return buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP';
      return false;
    } finally { await handle.close(); }
  }
}
