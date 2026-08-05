import { Global, Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { EventBus } from '../../shared/application';
import { InProcessEventBus } from './in-process-event-bus';
import { OutboxEventBus } from './outbox-event-bus';

@Global()
@Module({
  imports: [CqrsModule.forRoot()],
  providers: [InProcessEventBus, { provide: EventBus, useClass: OutboxEventBus }],
  exports: [EventBus, InProcessEventBus, CqrsModule],
})
export class EventBusModule {}
