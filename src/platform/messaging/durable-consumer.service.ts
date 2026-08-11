import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { AckPolicy, ConsumerMessages, DeliverPolicy, JsMsg } from '@nats-io/jetstream';

import { UnitOfWork } from '../../shared/application';
import { AppConfig } from '../config';
import { MetricsService } from '../observability/metrics.service';
import { DeadLetterRepository } from './dead-letter.repository';
import { DurableEventHandler, EventMessage } from './durable-event-handler';
import { NatsClient, STREAM_NAME, SUBJECT_PREFIX } from './nats-client';
import { ProcessedEventRepository } from './processed-event.repository';

function elapsedSeconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1e9;
}

function isEventMessage(value: unknown): value is EventMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<EventMessage>;

  return (
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.idempotencyKey === 'string' &&
    candidate.idempotencyKey.length > 0 &&
    typeof candidate.payload === 'object' &&
    candidate.payload !== null
  );
}

@Injectable()
export class DurableConsumerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DurableConsumerService.name);
  private readonly subscriptions: ConsumerMessages[] = [];
  private stopped = false;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly client: NatsClient,
    private readonly processed: ProcessedEventRepository,
    private readonly deadLetters: DeadLetterRepository,
    private readonly uow: UnitOfWork,
    private readonly config: AppConfig,
    private readonly metrics: MetricsService,
  ) {}

  /** Every provider that extends DurableEventHandler, wherever it is declared. */
  handlers(): DurableEventHandler[] {
    return this.discovery
      .getProviders()
      .map((wrapper) => wrapper.instance as unknown)
      .filter(
        (instance): instance is DurableEventHandler => instance instanceof DurableEventHandler,
      );
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.durableConsumer.enabled) {
      this.logger.warn('durable consumers disabled');
      return;
    }

    if (!this.client.isReady()) {
      this.logger.error('NATS unavailable; durable consumers not started');
      return;
    }

    for (const handler of this.handlers()) {
      try {
        await this.start(handler);
      } catch (error) {
        // One consumer that cannot be created must not stop the API from
        // serving requests. Its events stay on the stream and are delivered
        // once the deployment is fixed.
        this.logger.error(
          `consumer ${handler.consumerName} failed to start: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async start(handler: DurableEventHandler): Promise<void> {
    const { maxDeliver, ackWaitMs } = this.config.durableConsumer;

    const config = {
      durable_name: handler.consumerName,
      ack_policy: AckPolicy.Explicit,
      // All of it, not just what arrives after boot: a consumer added in a
      // later deploy still sees the history the stream retains.
      deliver_policy: DeliverPolicy.All,
      filter_subjects: handler.subjects.map((s) => `${SUBJECT_PREFIX}.${s}`),
      max_deliver: maxDeliver,
      ack_wait: ackWaitMs * 1_000_000,
    };

    const manager = this.client.manager();

    // `add` is not idempotent: on an existing durable whose configuration
    // differs it throws "consumer already exists". Creating and reconciling
    // therefore have to be told apart, or the first deploy that changes
    // max_deliver takes the whole application down at boot.
    const exists = await manager.consumers
      .info(STREAM_NAME, handler.consumerName)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      await manager.consumers.update(STREAM_NAME, handler.consumerName, {
        filter_subjects: config.filter_subjects,
        max_deliver: config.max_deliver,
        ack_wait: config.ack_wait,
      });
    } else {
      await manager.consumers.add(STREAM_NAME, config);
    }

    const consumer = await this.client.jetstream().consumers.get(STREAM_NAME, handler.consumerName);
    const messages = await consumer.consume();
    this.subscriptions.push(messages);

    void this.pump(handler, messages);

    this.logger.log(`consumer ${handler.consumerName} listening on ${handler.subjects.join(', ')}`);
  }

  private async pump(handler: DurableEventHandler, messages: ConsumerMessages): Promise<void> {
    for await (const message of messages) {
      if (this.stopped) break;
      await this.dispatch(handler, message);
    }
  }

  /** Exposed so tests can drive one message without racing the live loop. */
  async dispatch(handler: DurableEventHandler, message: JsMsg): Promise<void> {
    const { maxDeliver, nakDelayMs } = this.config.durableConsumer;
    let parsed: unknown;

    try {
      parsed = JSON.parse(new TextDecoder().decode(message.data));
    } catch (error) {
      // Unparseable will never become parseable. Retrying is pure waste.
      message.term('unparseable payload');
      this.logger.error(`${handler.consumerName}: discarded unparseable message: ${String(error)}`);
      return;
    }

    // Valid JSON is not a valid envelope. Anything on the subject that this
    // build does not recognise — an older schema, a hand-published probe — is
    // terminated rather than retried, and never reaches the dead-letter table,
    // whose columns assume a well-formed event.
    if (!isEventMessage(parsed)) {
      message.term('malformed envelope');
      this.logger.error(
        `${handler.consumerName}: discarded message with no valid envelope on ${message.subject}`,
      );
      return;
    }

    const event: EventMessage = parsed;
    const started = process.hrtime.bigint();
    let duplicate = false;

    try {
      await this.uow.withTransaction(async () => {
        // The marker and the handler's writes commit together, so a failure
        // rolls back both and redelivery genuinely retries.
        if (!(await this.processed.claim(handler.consumerName, event.idempotencyKey))) {
          this.logger.debug(`${handler.consumerName}: skipped duplicate ${event.idempotencyKey}`);
          duplicate = true;
          return;
        }

        await handler.handle(event);
      });

      message.ack();

      // Duplicates are counted separately rather than dropped: at-least-once
      // delivery makes some redelivery normal, but a duplicate rate that
      // climbs means the relay is re-sending, which is a different fault from
      // a handler that fails.
      this.metrics.eventConsumed(event.name, duplicate ? 'duplicate' : 'ok');
      this.metrics.eventHandled(event.name, elapsedSeconds(started));
    } catch (error) {
      this.metrics.eventConsumed(event.name, 'failed');
      this.metrics.eventHandled(event.name, elapsedSeconds(started));

      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const deliveryCount = message.info.deliveryCount;

      if (deliveryCount >= maxDeliver) {
        await this.deadLetters.record(handler.consumerName, event, reason, deliveryCount);
        this.metrics.eventDeadLettered(event.name);
        message.term('max deliveries exceeded');
        this.logger.error(
          `${handler.consumerName}: dead-lettered ${event.name} (${event.idempotencyKey}) after ${deliveryCount} deliveries: ${reason}`,
        );
        return;
      }

      message.nak(nakDelayMs);
      this.logger.warn(
        `${handler.consumerName}: delivery ${deliveryCount}/${maxDeliver} of ${event.name} failed, retrying: ${reason}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    for (const subscription of this.subscriptions) {
      subscription.stop();
    }
    await Promise.resolve();
  }
}
