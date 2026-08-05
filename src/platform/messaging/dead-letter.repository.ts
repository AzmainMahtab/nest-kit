import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { EventMessage } from './durable-event-handler';

export interface DeadLetterRow {
  id: string;
  consumer_name: string;
  event_name: string;
  idempotency_key: string;
  payload: EventMessage;
  error: string;
  delivery_count: number;
  created_at: Date;
}

@Injectable()
export class DeadLetterRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Recorded in Postgres rather than a DLQ subject on purpose: a dead letter is
   * something a human has to look at, and it needs to outlive the stream's
   * retention window.
   */
  async record(
    consumerName: string,
    event: EventMessage,
    error: string,
    deliveryCount: number,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO messaging.dead_letters
         (consumer_name, event_name, idempotency_key, payload, error, delivery_count)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (consumer_name, idempotency_key) DO UPDATE
          SET error = EXCLUDED.error,
              delivery_count = EXCLUDED.delivery_count,
              created_at = NOW()`,
      [
        consumerName,
        event.name,
        event.idempotencyKey,
        JSON.stringify(event),
        error.slice(0, 2000),
        deliveryCount,
      ],
    );
  }

  list(limit = 100): Promise<DeadLetterRow[]> {
    return this.dataSource.query<DeadLetterRow[]>(
      'SELECT * FROM messaging.dead_letters ORDER BY id DESC LIMIT $1',
      [limit],
    );
  }

  async countFor(consumerName: string): Promise<number> {
    const rows = await this.dataSource.query<{ count: string }[]>(
      'SELECT COUNT(*)::text AS count FROM messaging.dead_letters WHERE consumer_name = $1',
      [consumerName],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async count(): Promise<number> {
    const rows = await this.dataSource.query<{ count: string }[]>(
      'SELECT COUNT(*)::text AS count FROM messaging.dead_letters',
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Clears the processed marker and removes the dead letter, so a redelivery
   * (or a manual republish) is handled afresh.
   */
  async discard(consumerName: string, idempotencyKey: string): Promise<void> {
    await this.dataSource.query(
      'DELETE FROM messaging.dead_letters WHERE consumer_name = $1 AND idempotency_key = $2',
      [consumerName, idempotencyKey],
    );
    await this.dataSource.query(
      'DELETE FROM messaging.processed_events WHERE consumer_name = $1 AND idempotency_key = $2',
      [consumerName, idempotencyKey],
    );
  }
}
