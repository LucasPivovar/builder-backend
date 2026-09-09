import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserEntity } from '../auth/user.entity';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { PublicationController } from './publication.controller';
import { DomainProvisionerService } from './domain-provisioner.service';
import { PublicationEntity } from './publication.entity';
import { PublicationService } from './publication.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TypeOrmModule.forFeature([PublicationEntity, WorkspaceEntity, UserEntity]), AuthModule, AuditModule, NotificationsModule, BillingModule],
  controllers: [PublicationController],
  providers: [PublicationService, DomainProvisionerService],
  exports: [PublicationService]
})
export class PublicationModule {}
