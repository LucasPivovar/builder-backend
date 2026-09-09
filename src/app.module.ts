import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databasePath } from './config/local-config';
import { AuthModule } from './auth/auth.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { AppController } from './app.controller';
import { AdminModule } from './admin/admin.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PublicationModule } from './publications/publication.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { HostedVideosModule } from './videos/hosted-videos.module';
import { SupportModule } from './support/support.module';
import { HostedAssetsModule } from './assets/hosted-assets.module';
import { BillingModule } from './billing/billing.module';
import { EmailModule } from './email/email.module';
import { PrivacyModule } from './privacy/privacy.module';

const databaseOptions: any = process.env.DB_TYPE === 'postgres'
  ? { type:'postgres', url:process.env.DATABASE_URL, autoLoadEntities:true, synchronize:false, ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:process.env.DB_SSL_REJECT_UNAUTHORIZED!=='false'}:false }
  : { type:'sqljs', location:databasePath, autoSave:true, autoLoadEntities:true, synchronize:process.env.NODE_ENV!=='production'||process.env.DB_SYNCHRONIZE==='true' };

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    TypeOrmModule.forRoot(databaseOptions),
    AuthModule,
    WorkspaceModule,
    AdminModule,
    NotificationsModule,
    PublicationModule,
    AnalyticsModule
    , HostedVideosModule
    , SupportModule
    , HostedAssetsModule
    , BillingModule
    , EmailModule
    , PrivacyModule
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }]
})
export class AppModule {}
