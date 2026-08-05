import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { TransactionContext, TransactionalRepository } from '../database';

@Injectable()
export class ProcessedEventRepository extends TransactionalRepository {
  constructor(dataSource: DataSource, context: TransactionContext) {
    super(dataSource, context);
  }

  /**
   * Claims an event for a consumer. Returns false when it was already
   * processed.
   *
   * This must run on the same transaction as the handler's own writes: if the
   * marker committed separately, a handler that crashed after the marker but
   * before its work would never be retried, and the event would be silently
   * dropped. Rolling both back together is what makes redelivery correct.
   */
  async claim(consumerName: string, idempotencyKey: string): Promise<boolean> {
    const rows = await this.manager().query<{ idempotency_key: string }[]>(
      `INSERT INTO messaging.processed_events (consumer_name, idempotency_key)
       VALUES ($1, $2)
       ON CONFLICT (consumer_name, idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [consumerName, idempotencyKey],
    );

    return rows.length > 0;
  }

  async wasProcessed(consumerName: string, idempotencyKey: string): Promise<boolean> {
    const rows = await this.manager().query<{ one: number }[]>(
      `SELECT 1 AS one FROM messaging.processed_events
        WHERE consumer_name = $1 AND idempotency_key = $2`,
      [consumerName, idempotencyKey],
    );

    return rows.length > 0;
  }
}
