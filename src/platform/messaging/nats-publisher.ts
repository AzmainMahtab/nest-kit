import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { JetStreamClient, RetentionPolicy, jetstream, jetstreamManager } from '@nats-io/jetstream';
import { NatsConnection, connect } from '@nats-io/transport-node';

import { MessagePublisher } from '../../shared/application';
import { AppConfig } from '../config';

export const STREAM_NAME = 'DOMAIN_EVENTS';
export const SUBJECT_PREFIX = 'evt';

@Injectable()
export class NatsPublisher extends MessagePublisher implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NatsPublisher.name);
  private connection?: NatsConnection;
  private stream?: JetStreamClient;

  constructor(private readonly config: AppConfig) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      this.connection = await connect({
        servers: this.config.nats.url,
        name: 'nest-kit',
        maxReconnectAttempts: -1,
      });

      const manager = await jetstreamManager(this.connection);

      // Idempotent: matches whatever is already there, or creates it.
      await manager.streams.add({
        name: STREAM_NAME,
        subjects: [`${SUBJECT_PREFIX}.>`],
        retention: RetentionPolicy.Limits,
        max_age: this.config.nats.maxAgeMs * 1_000_000, // nanoseconds
        // Second line of defence behind the outbox's own unique key: a relay
        // that publishes twice inside this window is collapsed by the server.
        duplicate_window: 120 * 1_000_000_000,
      });

      this.stream = jetstream(this.connection);
      this.logger.log(`connected to ${this.config.nats.url}, stream ${STREAM_NAME} ready`);
    } catch (error) {
      // A broker outage must not stop the API from serving. Events keep
      // accumulating in the outbox and drain when NATS returns.
      this.logger.error(
        `NATS unavailable at ${this.config.nats.url}; events will queue in the outbox`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  isReady(): boolean {
    return this.stream !== undefined && this.connection?.isClosed() === false;
  }

  async publish(subject: string, payload: Uint8Array, messageId: string): Promise<void> {
    if (!this.stream) {
      throw new Error('NATS connection is not established');
    }

    // Resolves only after the server has persisted the message, so the relay
    // never marks a row published on a best-effort send.
    await this.stream.publish(`${SUBJECT_PREFIX}.${subject}`, payload, { msgID: messageId });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.connection && !this.connection.isClosed()) {
      await this.connection.drain();
      this.logger.log('connection drained');
    }
  }
}
