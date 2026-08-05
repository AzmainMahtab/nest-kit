import { Module } from '@nestjs/common';

import { ConfigModule } from './platform/config';
import { DatabaseModule } from './platform/database';
import { EventBusModule } from './platform/eventbus/eventbus.module';
import { HealthModule } from './platform/health/health.module';

@Module({
  imports: [ConfigModule, DatabaseModule, EventBusModule, HealthModule],
})
export class AppModule {}
