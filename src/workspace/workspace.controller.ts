import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
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

  @Put()
  save(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveWorkspaceDto) {
    return this.workspaceService.save(user.userId, dto);
  }
}
