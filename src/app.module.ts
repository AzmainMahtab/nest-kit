import { Module } from '@nestjs/common';

import { AuthModule } from './modules/auth';
import { CarModule } from './modules/car';
import { IdentityModule } from './modules/identity';
import { NotificationModule } from './modules/notification';
import { OwnerModule } from './modules/owner';
import { RbacModule } from './modules/rbac';
import { CacheModule } from './platform/cache/cache.module';
import { ConfigModule } from './platform/config';
import { CryptoModule } from './platform/crypto/crypto.module';
import { DatabaseModule } from './platform/database';
import { EventBusModule } from './platform/eventbus/eventbus.module';
import { HealthModule } from './platform/health/health.module';
import { HttpModule } from './platform/http/http.module';
import { MessagingModule } from './platform/messaging/messaging.module';
import { MailModule } from './platform/mail/mail.module';
import { ObservabilityModule } from './platform/observability';
import { OutboxModule } from './platform/outbox';
import { SchedulingModule } from './platform/scheduling/scheduling.module';
import { StorageModule } from './platform/storage/storage.module';
import { UpstreamModule } from './platform/upstream/upstream.module';

@Module({
  imports: [
    ConfigModule,
    // Before everything it instruments, so the correlation id is set and the
    // request is timed even when a later module's middleware short-circuits.
    ObservabilityModule,
    MessagingModule,
    OutboxModule,
    DatabaseModule,
    CryptoModule,
    CacheModule,
    MailModule,
    SchedulingModule,
    StorageModule,
    UpstreamModule,
    EventBusModule,
    // Registers the rate limiter as a global guard. Must stay above
    // AuthModule — Nest runs global guards in registration order, and the
    // limiter has to see a request before JwtAuthGuard rejects it.
    HttpModule,
    HealthModule,
    IdentityModule,
    AuthModule,
    RbacModule,
    NotificationModule,
    OwnerModule,
    CarModule,
  ],
})
export class AppModule {}
