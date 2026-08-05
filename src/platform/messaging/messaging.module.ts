import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { MessagePublisher } from '../../shared/application';
import { OutboxModule } from '../outbox';
import { DeadLetterRepository } from './dead-letter.repository';
import { DurableConsumerService } from './durable-consumer.service';
import { MessagingAdminController } from './messaging-admin.controller';
import { MessagingMetricsService } from './messaging-metrics.service';
import { NatsClient } from './nats-client';
import { NatsPublisher } from './nats-publisher';
import { ProcessedEventRepository } from './processed-event.repository';

@Global()
@Module({
  imports: [DiscoveryModule, OutboxModule],
  controllers: [MessagingAdminController],
  providers: [
    NatsClient,
    { provide: MessagePublisher, useClass: NatsPublisher },
    ProcessedEventRepository,
    DeadLetterRepository,
    DurableConsumerService,
    MessagingMetricsService,
  ],
  exports: [
    MessagePublisher,
    NatsClient,
    ProcessedEventRepository,
    DeadLetterRepository,
    DurableConsumerService,
    MessagingMetricsService,
  ],
})
export class MessagingModule {}
