import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview') overview() { return this.adminService.overview(); }
  @Get('users') users() { return this.adminService.listUsers(); }
  @Get('history') history() { return this.adminService.history(); }
  @Post('alerts') createAlert(@Body() body: { title?: string; message?: string; type?: string; target?: string; userId?: string }) {
    return this.adminService.createAlert(body);
  }
  @Get('users/:userId/workspace') workspace(@Param('userId') userId: string) { return this.adminService.userWorkspace(userId); }
  @Post('users/:userId/backups/:backupId/restore') restore(
    @Param('userId') userId: string,
    @Param('backupId') backupId: string
  ) { return this.adminService.restore(userId, backupId); }
}
