import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from './audit-log.entity';

export type AuditType = 'success' | 'error' | 'pending' | 'info' | 'warning';

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLogEntity) private readonly logs: Repository<AuditLogEntity>) {}

  async record(input: {
    userId?: string | null;
    userEmail?: string;
    type: AuditType | string;
    title: string;
    message: string;
    pageId?: string;
    pageName?: string;
    meta?: Record<string, unknown> | null;
  }) {
    const row = this.logs.create({
      userId: input.userId || null,
      userEmail: input.userEmail || '',
      type: input.type,
      title: input.title.slice(0, 140),
      message: input.message.slice(0, 700),
      pageId: input.pageId || '',
      pageName: input.pageName || '',
      meta: input.meta || null
    });
    return this.logs.save(row);
  }

  async list(limit = 120) {
    return this.logs.find({ order: { createdAt: 'DESC' }, take: Math.max(1, Math.min(300, limit)) });
  }
}
