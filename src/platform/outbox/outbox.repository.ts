import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { DomainEvent } from '../../shared/domain';
import { SerializedEvent, serializeEvent } from './event-serializer';

export interface OutboxRow {
  id: string;
  name: string;
  version: string;
  idempotency_key: string;
  occurred_at: Date;
  payload: Record<string, unknown>;
  attempts: number;
}

@Injectable()
export class OutboxRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Writes on the caller's manager, so the rows commit or roll back with the
   * business data. That atomicity is the entire point of the pattern — it is
   * what removes the dual-write between the database and the broker.
   */
  async append(events: readonly DomainEvent[], manager: EntityManager): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const records = events.map(serializeEvent);
    const values: unknown[] = [];
    const tuples = records.map((record: SerializedEvent, i) => {
      values.push(
        record.name,
        record.version,
        record.idempotencyKey,
        record.occurredAt,
        JSON.stringify(record.payload),
      );
      const base = i * 5;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb)`;
    });

    await manager.query(
      `INSERT INTO outbox.events (name, version, idempotency_key, occurred_at, payload)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (idempotency_key) DO NOTHING`,
      values,
    );
  }

  /**
   * Claims a batch for this relay instance. FOR UPDATE SKIP LOCKED is what
   * makes running more than one API replica safe: each claims a disjoint set
   * instead of racing to publish the same row twice.
   */
  /**
   * Every statement here ends in a SELECT over a CTE rather than being a bare
   * `UPDATE ... RETURNING`. TypeORM's `query()` returns `[rows, affectedCount]`
   * for update-shaped commands and a plain row array for selects, so wrapping
   * keeps the return shape predictable instead of driver-dependent.
   */
  claimBatch(limit: number, maxAttempts: number): Promise<OutboxRow[]> {
    return this.dataSource.transaction((manager) =>
      manager.query<OutboxRow[]>(
        `WITH claimed AS (
           SELECT id
             FROM outbox.events
            WHERE published_at IS NULL
              AND dead_lettered_at IS NULL
              AND attempts < $2
            ORDER BY id
            LIMIT $1
              FOR UPDATE SKIP LOCKED
         ), bumped AS (
           UPDATE outbox.events e
              SET attempts = e.attempts + 1
             FROM claimed
            WHERE e.id = claimed.id
        RETURNING e.id, e.name, e.version, e.idempotency_key, e.occurred_at, e.payload, e.attempts
         )
         SELECT * FROM bumped ORDER BY id`,
        [limit, maxAttempts],
      ),
    );
  }

  async markPublished(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.dataSource.query(
      'UPDATE outbox.events SET published_at = NOW(), last_error = NULL WHERE id = ANY($1::bigint[])',
      [ids],
    );
  }

  async recordFailure(id: string, error: string, maxAttempts: number): Promise<void> {
    await this.dataSource.query(
      `UPDATE outbox.events
          SET last_error = $2,
              dead_lettered_at = CASE WHEN attempts >= $3 THEN NOW() ELSE NULL END
        WHERE id = $1`,
      [id, error.slice(0, 2000), maxAttempts],
    );
  }

  async countPending(): Promise<number> {
    const rows = await this.dataSource.query<{ count: string }[]>(
      'SELECT COUNT(*)::text AS count FROM outbox.events WHERE published_at IS NULL AND dead_lettered_at IS NULL',
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Clears the dead-letter state so the relay picks the rows up again. */
  async replayDeadLettered(ids: string[]): Promise<number> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `WITH revived AS (
         UPDATE outbox.events
            SET dead_lettered_at = NULL, attempts = 0, last_error = NULL
          WHERE dead_lettered_at IS NOT NULL
            AND ($1::bigint[] IS NULL OR id = ANY($1::bigint[]))
      RETURNING id
       )
       SELECT id FROM revived`,
      [ids.length > 0 ? ids : null],
    );
    return rows.length;
  }
}
