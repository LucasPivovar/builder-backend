import { Body, Controller, Get, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SaveWorkspaceDto } from './workspace.dto';
import { WorkspaceService } from './workspace.service';

@UseGuards(JwtAuthGuard)
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.workspaceService.get(user.userId);
  }

  @Get('platform-templates')
  platformTemplates() {
    return this.workspaceService.platformTemplates();
  }

  @Get('backups')
  backups(@CurrentUser() user: AuthenticatedUser) { return this.workspaceService.backupSummaries(user.userId); }

  @Get('backups/:id/diff')
  backupDiff(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.workspaceService.backupDiff(user.userId, id); }

  @Post('backups/:id/restore')
  async restore(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const result = await this.workspaceService.restoreBackup(user.userId, id, 'Antes da restauração pelo usuário', 'usuário');
    if (!result) throw new NotFoundException('Backup não encontrado.');
    return result;
  }

  @Put()
  save(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveWorkspaceDto) {
    return this.workspaceService.save(user.userId, dto);
  }
}
