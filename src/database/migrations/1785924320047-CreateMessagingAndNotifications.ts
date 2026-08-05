import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMessagingAndNotifications1785924320047 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS messaging');

    // Consumer-side dedup. Keyed by consumer as well as event, because each
    // consumer must process every event exactly once independently — one
    // consumer succeeding says nothing about another.
    await queryRunner.query(`
      CREATE TABLE messaging.processed_events (
          consumer_name    VARCHAR(128) NOT NULL,
          idempotency_key  UUID NOT NULL,
          processed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (consumer_name, idempotency_key)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE messaging.dead_letters (
          id               BIGSERIAL PRIMARY KEY,
          consumer_name    VARCHAR(128) NOT NULL,
          event_name       VARCHAR(128) NOT NULL,
          idempotency_key  UUID NOT NULL,
          payload          JSONB NOT NULL,
          error            TEXT NOT NULL,
          delivery_count   INTEGER NOT NULL,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (consumer_name, idempotency_key)
      )
    `);

    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS notification');

    await queryRunner.query(`
      CREATE TABLE notification.notifications (
          id              BIGSERIAL PRIMARY KEY,
          uuid            UUID NOT NULL UNIQUE,
          recipient_uuid  UUID NOT NULL,
          channel         VARCHAR(32) NOT NULL,
          subject         VARCHAR(256) NOT NULL,
          body            TEXT NOT NULL,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // recipient_uuid is an id, not a foreign key: identity owns its table and a
    // cross-schema FK would have to be dropped before either context could be
    // extracted (AGENTS.md §13).
    await queryRunner.query(`
      CREATE INDEX notifications_recipient_idx
          ON notification.notifications (recipient_uuid)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE notification.notifications');
    await queryRunner.query('DROP SCHEMA IF EXISTS notification');
    await queryRunner.query('DROP TABLE messaging.dead_letters');
    await queryRunner.query('DROP TABLE messaging.processed_events');
    await queryRunner.query('DROP SCHEMA IF EXISTS messaging');
  }
}
