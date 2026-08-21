import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PublicationController } from './publication.controller';
import { PublicationEntity } from './publication.entity';
import { PublicationService } from './publication.service';

@Module({
  imports: [TypeOrmModule.forFeature([PublicationEntity]), AuthModule, AuditModule, NotificationsModule],
  controllers: [PublicationController],
  providers: [PublicationService],
  exports: [PublicationService]
})
export class PublicationModule {}
