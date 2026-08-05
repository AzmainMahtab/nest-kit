import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import {
  JetStreamClient,
  JetStreamManager,
  RetentionPolicy,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import { NatsConnection, connect } from '@nats-io/transport-node';

import { AppConfig } from '../config';

export const STREAM_NAME = 'DOMAIN_EVENTS';
export const SUBJECT_PREFIX = 'evt';

/**
 * Owns the single connection and the stream definition. The publisher and the
 * durable consumers share it rather than each opening their own, so there is
 * one place that knows how to reach the broker and one place that drains on
 * shutdown.
 */
@Injectable()
export class NatsClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NatsClient.name);
  private connection?: NatsConnection;
  private js?: JetStreamClient;
  private jsm?: JetStreamManager;

  constructor(private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    try {
      this.connection = await connect({
        servers: this.config.nats.url,
        name: 'nest-kit',
        maxReconnectAttempts: -1,
      });

      this.jsm = await jetstreamManager(this.connection);

      // Idempotent: matches whatever is already there, or creates it.
      await this.jsm.streams.add({
        name: STREAM_NAME,
        subjects: [`${SUBJECT_PREFIX}.>`],
        retention: RetentionPolicy.Limits,
        max_age: this.config.nats.maxAgeMs * 1_000_000, // nanoseconds
        // Second line of defence behind the outbox's own unique key: a relay
        // that publishes twice inside this window is collapsed by the server.
        duplicate_window: 120 * 1_000_000_000,
      });

      this.js = jetstream(this.connection);
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
    return this.js !== undefined && this.connection?.isClosed() === false;
  }

  jetstream(): JetStreamClient {
    if (!this.js) {
      throw new Error('NATS connection is not established');
    }
    return this.js;
  }

  manager(): JetStreamManager {
    if (!this.jsm) {
      throw new Error('NATS connection is not established');
    }
    return this.jsm;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.connection && !this.connection.isClosed()) {
      await this.connection.drain();
      this.logger.log('connection drained');
    }
  }
}
