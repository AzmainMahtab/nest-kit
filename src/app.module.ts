import { Module } from '@nestjs/common';

import { AuthModule } from './modules/auth';
import { IdentityModule } from './modules/identity';
import { NotificationModule } from './modules/notification';
import { CacheModule } from './platform/cache/cache.module';
import { ConfigModule } from './platform/config';
import { CryptoModule } from './platform/crypto/crypto.module';
import { DatabaseModule } from './platform/database';
import { EventBusModule } from './platform/eventbus/eventbus.module';
import { HealthModule } from './platform/health/health.module';
import { MessagingModule } from './platform/messaging/messaging.module';
import { OutboxModule } from './platform/outbox';

@Module({
  imports: [
    ConfigModule,
    MessagingModule,
    OutboxModule,
    DatabaseModule,
    CryptoModule,
    CacheModule,
    EventBusModule,
    HealthModule,
    IdentityModule,
    AuthModule,
    NotificationModule,
  ],
})
export class AppModule {}
