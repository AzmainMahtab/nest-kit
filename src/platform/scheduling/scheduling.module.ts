import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { LeaderLock } from './leader-lock';
import { SchedulerService } from './scheduler.service';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [LeaderLock, SchedulerService],
  exports: [LeaderLock],
})
export class SchedulingModule {}
