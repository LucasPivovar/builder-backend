import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { HostedVideoEntity } from './hosted-video.entity';
import { HostedVideosController } from './hosted-videos.controller';
import { HostedVideosService } from './hosted-videos.service';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TypeOrmModule.forFeature([HostedVideoEntity, WorkspaceEntity]), AuthModule, BillingModule],
  controllers: [HostedVideosController],
  providers: [HostedVideosService]
})
export class HostedVideosModule {}
