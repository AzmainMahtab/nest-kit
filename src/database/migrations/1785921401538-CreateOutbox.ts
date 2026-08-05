import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutbox1785921401538 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS outbox');

    await queryRunner.query(`
      CREATE TABLE outbox.events (
          id                BIGSERIAL PRIMARY KEY,
          name              VARCHAR(128) NOT NULL,
          version           VARCHAR(16)  NOT NULL,
          idempotency_key   UUID NOT NULL UNIQUE,
          occurred_at       TIMESTAMPTZ NOT NULL,
          payload           JSONB NOT NULL,
          attempts          INTEGER NOT NULL DEFAULT 0,
          last_error        TEXT,
          published_at      TIMESTAMPTZ,
          dead_lettered_at  TIMESTAMPTZ,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // The relay's only hot query. Partial, so the index stays proportional to
    // the backlog rather than to the full event history — which is what keeps
    // it small on a table that only ever grows.
    await queryRunner.query(`
      CREATE INDEX events_pending_idx
          ON outbox.events (id)
       WHERE published_at IS NULL AND dead_lettered_at IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX events_dead_lettered_idx
          ON outbox.events (dead_lettered_at)
       WHERE dead_lettered_at IS NOT NULL
    `);

    // No index on idempotency_key: the UNIQUE constraint already creates one.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE outbox.events');
    await queryRunner.query('DROP SCHEMA IF EXISTS outbox');
  }
}
