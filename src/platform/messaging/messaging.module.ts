import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { MessagePublisher } from '../../shared/application';
import { DeadLetterRepository } from './dead-letter.repository';
import { DurableConsumerService } from './durable-consumer.service';
import { NatsClient } from './nats-client';
import { NatsPublisher } from './nats-publisher';
import { ProcessedEventRepository } from './processed-event.repository';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    NatsClient,
    { provide: MessagePublisher, useClass: NatsPublisher },
    ProcessedEventRepository,
    DeadLetterRepository,
    DurableConsumerService,
  ],
  exports: [
    MessagePublisher,
    NatsClient,
    ProcessedEventRepository,
    DeadLetterRepository,
    DurableConsumerService,
  ],
})
export class MessagingModule {}
