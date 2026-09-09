import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller()
export class AppController {
  constructor(private readonly dataSource: DataSource) {}
  @Get('health')
  health() {
    return { status: 'ok', service: 'funil-builder-api', timestamp: new Date().toISOString() };
  }

  @Get('health/live')
  live() { return this.health(); }

  @Get('health/ready')
  async ready() { await this.dataSource.query('SELECT 1'); return { status:'ready', database:'ok', timestamp:new Date().toISOString() }; }
}
