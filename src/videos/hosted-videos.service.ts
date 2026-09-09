import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { open, unlink } from 'fs/promises';
import { join } from 'path';
import { Repository } from 'typeorm';
import { hostedVideoLimits, hostedVideosDirectory, publicBaseUrl } from '../config/local-config';
import { HostedVideoEntity } from './hosted-video.entity';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class HostedVideosService {
  constructor(
    @InjectRepository(HostedVideoEntity) private readonly videos: Repository<HostedVideoEntity>,
    @InjectRepository(WorkspaceEntity) private readonly workspaces: Repository<WorkspaceEntity>,
    private readonly billing: BillingService
  ) {}

  async create(userId: string, file: { originalname: string; mimetype: string; filename: string; size: number }) {
    if (!file) throw new BadRequestException('Selecione um vídeo.');
    const path = join(hostedVideosDirectory, file.filename);
    if (!(await this.hasValidSignature(path, file.mimetype))) {
      await unlink(path).catch(() => undefined);
      throw new BadRequestException('O conteúdo do arquivo não corresponde a um vídeo suportado.');
    }
    const existing = await this.videos.find({ where: { userId } });
    const usedBytes = existing.reduce((total, video) => total + Number(video.size || 0), 0);
    const limits = await this.billing.limits(userId);
    const maxBytes = Math.min(hostedVideoLimits.maxTotalBytesPerUser, limits.maxVideoBytes);
    if (existing.length >= hostedVideoLimits.maxVideosPerUser || usedBytes + file.size > maxBytes) {
      await unlink(join(hostedVideosDirectory, file.filename)).catch(() => undefined);
      throw new BadRequestException('Limite de armazenamento de vídeos atingido.');
    }
    const row = await this.videos.save(this.videos.create({
      userId,
      originalName: file.originalname.slice(0, 255),
      mimeType: file.mimetype,
      storageName: file.filename,
      size: file.size,
      publicUrl: `${publicBaseUrl}/media/videos/${file.filename}`
    }));
    return this.response(row);
  }

  async list(userId: string) {
    const rows = await this.videos.find({ where: { userId }, order: { createdAt: 'DESC' } });
    const workspace = await this.workspaces.findOneBy({ userId });
    const serialized = JSON.stringify(workspace?.data || {});
    return rows.map(row => ({ ...this.response(row), inUse: serialized.includes(row.id) || serialized.includes(row.publicUrl) }));
  }

  async usage(userId: string) {
    const rows = await this.videos.find({ where: { userId } });
    const limits = await this.billing.limits(userId);
    return {
      count: rows.length,
      maxCount: hostedVideoLimits.maxVideosPerUser,
      bytes: rows.reduce((total, video) => total + Number(video.size || 0), 0),
      maxBytes: Math.min(hostedVideoLimits.maxTotalBytesPerUser, limits.maxVideoBytes)
    };
  }

  async remove(userId: string, id: string) {
    const row = await this.videos.findOneBy({ id, userId });
    if (!row) throw new NotFoundException('Vídeo não encontrado.');
    const workspace = await this.workspaces.findOneBy({ userId });
    const serialized = JSON.stringify(workspace?.data || {});
    if (serialized.includes(row.id) || serialized.includes(row.publicUrl)) {
      throw new ConflictException('Este vídeo ainda está vinculado a uma página. Desvincule-o e salve o workspace antes de excluir.');
    }
    await this.videos.remove(row);
    await unlink(join(hostedVideosDirectory, row.storageName)).catch(() => undefined);
    return { ok: true };
  }

  private response(row: HostedVideoEntity) {
    return { id: row.id, name: row.originalName, mimeType: row.mimeType, size: row.size, url: row.publicUrl, createdAt: row.createdAt };
  }

  private async hasValidSignature(path: string, mimeType: string) {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(16);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead < 4) return false;
      if (mimeType === 'video/webm') return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      if (mimeType === 'video/ogg') return buffer.subarray(0, 4).toString('ascii') === 'OggS';
      return bytesRead >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
    } finally {
      await handle.close();
    }
  }
}
