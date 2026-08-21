import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsEventEntity } from './analytics-event.entity';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [TypeOrmModule.forFeature([AnalyticsEventEntity]), WorkspaceModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService]
})
export class AnalyticsModule {}
