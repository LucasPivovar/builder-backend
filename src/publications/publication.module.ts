import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserEntity } from '../auth/user.entity';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { PublicationController } from './publication.controller';
import { PublicationEntity } from './publication.entity';
import { PublicationService } from './publication.service';

@Module({
  imports: [TypeOrmModule.forFeature([PublicationEntity, WorkspaceEntity, UserEntity]), AuthModule, AuditModule, NotificationsModule],
  controllers: [PublicationController],
  providers: [PublicationService],
  exports: [PublicationService]
})
export class PublicationModule {}
