import { Module } from '@nestjs/common';

import { IdentityModule } from './modules/identity';
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
    EventBusModule,
    HealthModule,
    IdentityModule,
  ],
})
export class AppModule {}
