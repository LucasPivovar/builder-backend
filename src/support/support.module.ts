import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SupportTicketEntity } from './support-ticket.entity';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { UserEntity } from '../auth/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([SupportTicketEntity, UserEntity]), AuthModule, AuditModule, NotificationsModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService]
})
export class SupportModule {}
