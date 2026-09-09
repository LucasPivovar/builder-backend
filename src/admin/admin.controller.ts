import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, Min } from 'class-validator';
import { SupportService } from '../support/support.service';
import { AdminUpdateSupportTicketDto } from '../support/support-ticket.dto';
import { BillingService } from '../billing/billing.service';
import { DecidePlanRequestDto } from '../billing/billing.dto';
class AdminPageDto {
  @IsInt() @Min(0) revision: number;
  @IsObject() page: Record<string, unknown>;
}
class AdminUserAccessDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsIn(['admin', 'user']) role?: 'admin' | 'user';
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService, private readonly support: SupportService, private readonly billing: BillingService) {}

  @Get('overview') overview() { return this.adminService.overview(); }
  @Get('users') users() { return this.adminService.listUsers(); }
  @Patch('users/:userId/access') updateUserAccess(@CurrentUser() actor: AuthenticatedUser, @Param('userId') userId: string, @Body() body: AdminUserAccessDto) {
    return this.adminService.updateUserAccess(actor.userId, userId, body);
  }
  @Get('pages') pages() { return this.adminService.listAllPages(); }
  @Get('history') history() { return this.adminService.history(); }
  @Get('support/tickets') supportTickets() { return this.support.listAll(); }
  @Get('billing/requests') billingRequests() { return this.billing.listRequests(); }
  @Post('billing/requests/:id') decideBillingRequest(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: DecidePlanRequestDto) { return this.billing.decide(actor.userId,id,body.status); }
  @Post('support/tickets/:id') updateSupportTicket(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: AdminUpdateSupportTicketDto) {
    return this.support.adminUpdate(actor.userId, id, body);
  }
  @Post('users/:userId/pages/:pageId') savePage(@CurrentUser() actor: AuthenticatedUser, @Param('userId') userId: string, @Param('pageId') pageId: string, @Body() body: AdminPageDto) {
    return this.adminService.savePage(actor.userId, userId, pageId, body);
  }
  @Post('alerts') createAlert(@Body() body: { title?: string; message?: string; type?: string; target?: string; userId?: string }) {
    return this.adminService.createAlert(body);
  }
  @Get('users/:userId/workspace') workspace(@Param('userId') userId: string) { return this.adminService.userWorkspace(userId); }
  @Delete('users/:userId/sessions/:sessionId') revokeSession(@CurrentUser() actor: AuthenticatedUser, @Param('userId') userId: string, @Param('sessionId') sessionId: string) {
    return this.adminService.revokeUserSession(actor.userId, userId, sessionId);
  }
  @Delete('users/:userId/sessions') revokeSessions(@CurrentUser() actor: AuthenticatedUser, @Param('userId') userId: string) {
    return this.adminService.revokeUserSessions(actor.userId, userId);
  }
  @Post('users/:userId/backups/:backupId/restore') restore(
    @Param('userId') userId: string,
    @Param('backupId') backupId: string
  ) { return this.adminService.restore(userId, backupId); }
}
