import { Module } from '@nestjs/common';

import { IdentityModule } from './modules/identity';
import { ConfigModule } from './platform/config';
import { CryptoModule } from './platform/crypto/crypto.module';
import { DatabaseModule } from './platform/database';
import { EventBusModule } from './platform/eventbus/eventbus.module';
import { HealthModule } from './platform/health/health.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CryptoModule,
    EventBusModule,
    HealthModule,
    IdentityModule,
  ],
})
export class AppModule {}
