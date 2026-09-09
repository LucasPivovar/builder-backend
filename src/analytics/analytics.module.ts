import { Module } from '@nestjs/common';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { PublicationEntity } from '../publications/publication.entity';
import { PopupSubmissionEntity } from './popup-submission.entity';
import { PopupSubmissionService } from './popup-submission.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsEventEntity } from './analytics-event.entity';
import { AnalyticsService } from './analytics.service';
import { EmailTrackingController } from './email-tracking.controller';
import { WebhookDeliveryEntity } from './webhook-delivery.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AnalyticsEventEntity, PublicationEntity, PopupSubmissionEntity, WorkspaceEntity, WebhookDeliveryEntity]), WorkspaceModule],
  controllers: [AnalyticsController, EmailTrackingController],
  providers: [AnalyticsService, PopupSubmissionService],
  exports: [AnalyticsService]
})
export class AnalyticsModule {}
