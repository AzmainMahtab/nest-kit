import { Module } from '@nestjs/common';

import { ConfigModule } from './platform/config';
import { EventBusModule } from './platform/eventbus/eventbus.module';
import { HealthModule } from './platform/health/health.module';

@Module({
  imports: [ConfigModule, EventBusModule, HealthModule],
})
export class AppModule {}
