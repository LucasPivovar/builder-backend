import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PublicationEntity } from '../publications/publication.entity';
import { UserEntity } from '../auth/user.entity';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { SupportModule } from '../support/support.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, WorkspaceEntity, PublicationEntity]), AuthModule, WorkspaceModule, NotificationsModule, AuditModule, SupportModule, BillingModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard]
})
export class AdminModule {}
