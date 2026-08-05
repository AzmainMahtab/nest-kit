import { Injectable, Logger } from '@nestjs/common';

import { OutboxRepository, OutboxStats } from '../outbox/outbox.repository';
import { DeadLetterRepository } from './dead-letter.repository';
import { DurableConsumerService } from './durable-consumer.service';
import { NatsClient, STREAM_NAME } from './nats-client';

export interface ConsumerLag {
  name: string;
  subjects: string[];
  /** Messages matched by the filter that this consumer has not received yet. */
  pending: number;
  /** Delivered but not yet acked — in flight, or being retried. */
  ackPending: number;
  /** Cumulative redeliveries. Rising without `pending` falling means failures. */
  redelivered: number;
  deadLetters: number;
  /** False when the consumer is missing from the stream, e.g. it failed to start. */
  present: boolean;
}

export interface MessagingStatus {
  brokerReachable: boolean;
  stream: { name: string; messages: number; bytes: number } | null;
  outbox: OutboxStats;
  consumers: ConsumerLag[];
}

/**
 * Backlog on both sides of the broker.
 *
 * The outbox answers "are we getting events out?"; consumer lag answers "is
 * anyone keeping up?". A healthy system has both near zero — a rising outbox
 * points at the relay or the broker, rising consumer `pending` points at a slow
 * or dead handler.
 */
@Injectable()
export class MessagingMetricsService {
  private readonly logger = new Logger(MessagingMetricsService.name);

  constructor(
    private readonly client: NatsClient,
    private readonly consumers: DurableConsumerService,
    private readonly outbox: OutboxRepository,
    private readonly deadLetters: DeadLetterRepository,
  ) {}

  async status(): Promise<MessagingStatus> {
    const outbox = await this.outbox.stats();

    if (!this.client.isReady()) {
      // Still report the outbox: when NATS is down that is the number that
      // matters, because it is what keeps growing.
      return { brokerReachable: false, stream: null, outbox, consumers: [] };
    }

    return {
      brokerReachable: true,
      stream: await this.streamState(),
      outbox,
      consumers: await this.consumerLag(),
    };
  }

  private async streamState(): Promise<MessagingStatus['stream']> {
    try {
      const info = await this.client.manager().streams.info(STREAM_NAME);
      return {
        name: info.config.name,
        messages: info.state.messages,
        bytes: info.state.bytes,
      };
    } catch (error) {
      this.logger.warn(`stream ${STREAM_NAME} unreadable: ${asMessage(error)}`);
      return null;
    }
  }

  private async consumerLag(): Promise<ConsumerLag[]> {
    const handlers = this.consumers.handlers();

    return Promise.all(
      handlers.map(async (handler): Promise<ConsumerLag> => {
        const deadLetters = await this.deadLetters.countFor(handler.consumerName);

        try {
          const info = await this.client
            .manager()
            .consumers.info(STREAM_NAME, handler.consumerName);

          return {
            name: handler.consumerName,
            subjects: handler.subjects,
            pending: info.num_pending,
            ackPending: info.num_ack_pending,
            redelivered: info.num_redelivered,
            deadLetters,
            present: true,
          };
        } catch {
          // A declared handler with no consumer on the stream is a real fault —
          // it means start-up failed and nothing is being delivered to it.
          return {
            name: handler.consumerName,
            subjects: handler.subjects,
            pending: 0,
            ackPending: 0,
            redelivered: 0,
            deadLetters,
            present: false,
          };
        }
      }),
    );
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
