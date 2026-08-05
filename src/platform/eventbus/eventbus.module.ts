import { Global, Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { EventBus } from '../../shared/application';
import { InProcessEventBus } from './in-process-event-bus';

@Global()
@Module({
  imports: [CqrsModule.forRoot()],
  providers: [{ provide: EventBus, useClass: InProcessEventBus }],
  exports: [EventBus, CqrsModule],
})
export class EventBusModule {}
