import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { MessagePublisher } from '../../shared/application';
import { AppConfig } from '../config';
import { toMessage } from './event-serializer';
import { OutboxRepository, OutboxRow } from './outbox.repository';

/**
 * Drains committed outbox rows to the broker.
 *
 * Delivery is at-least-once by construction: a row is marked published only
 * after the broker acknowledges persistence, so a crash between publish and
 * mark re-sends. That is why every message carries `idempotencyKey` and why
 * the stream sets a duplicate window — consumers must be idempotent.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly publisher: MessagePublisher,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.outbox.enabled) {
      this.logger.warn('relay disabled; events will accumulate unpublished');
      return;
    }

    this.timer = setInterval(() => void this.tick(), this.config.outbox.intervalMs);
    // Do not hold the event loop open on shutdown.
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** Exposed so tests can drive a drain deterministically instead of waiting. */
  async tick(): Promise<number> {
    // Overlapping ticks would double the work, not speed it up — SKIP LOCKED
    // already lets separate replicas run concurrently.
    if (this.running || this.stopped || !this.publisher.isReady()) {
      return 0;
    }

    this.running = true;

    try {
      return await this.drain();
    } catch (error) {
      this.logger.error('relay tick failed', error instanceof Error ? error.stack : String(error));
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<number> {
    const { batchSize, maxAttempts } = this.config.outbox;
    const rows = await this.outbox.claimBatch(batchSize, maxAttempts);

    if (rows.length === 0) {
      return 0;
    }

    const published: string[] = [];

    for (const row of rows) {
      try {
        await this.publisher.publish(
          row.name,
          toMessage(this.toSerialized(row)),
          row.idempotency_key,
        );
        published.push(row.id);
      } catch (error) {
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        await this.outbox.recordFailure(row.id, message, maxAttempts);

        // Logged on every failure, not only on dead-letter. A relay that
        // retries quietly for five minutes and then gives up is the kind of
        // outage nobody notices until the backlog is hours deep.
        this.logger.warn(
          `publish failed for ${row.name} (${row.id}), attempt ${row.attempts}/${maxAttempts}: ${message}`,
        );

        if (row.attempts >= maxAttempts) {
          this.logger.error(`event ${row.name} (${row.id}) dead-lettered: ${message}`);
        }
      }
    }

    await this.outbox.markPublished(published);

    if (published.length > 0) {
      this.logger.debug(`published ${published.length}/${rows.length} outbox rows`);
    }

    return published.length;
  }

  private toSerialized(row: OutboxRow) {
    return {
      name: row.name,
      version: row.version,
      idempotencyKey: row.idempotency_key,
      occurredAt: row.occurred_at,
      payload: row.payload,
    };
  }
}
