import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationDelivery1786000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notification.notifications
          ADD COLUMN recipient_address VARCHAR(320) NOT NULL DEFAULT '',
          ADD COLUMN status            VARCHAR(16)  NOT NULL DEFAULT 'QUEUED',
          ADD COLUMN attempts          INT          NOT NULL DEFAULT 0,
          ADD COLUMN last_error        TEXT,
          ADD COLUMN sent_at           TIMESTAMPTZ,
          ADD COLUMN updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    `);

    // The default existed only to fill rows written before the column did.
    // Leaving it would let a future insert quietly queue a message addressed
    // to nobody.
    await queryRunner.query(`
      ALTER TABLE notification.notifications
          ALTER COLUMN recipient_address DROP DEFAULT
    `);

    // Covers exactly the dispatcher's sweep. A full index on status would be
    // mostly SENT rows, which is the half never queried.
    await queryRunner.query(`
      CREATE INDEX notifications_queued_idx
          ON notification.notifications (id)
          WHERE status = 'QUEUED'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX notification.notifications_queued_idx');
    await queryRunner.query(`
      ALTER TABLE notification.notifications
          DROP COLUMN recipient_address,
          DROP COLUMN status,
          DROP COLUMN attempts,
          DROP COLUMN last_error,
          DROP COLUMN sent_at,
          DROP COLUMN updated_at
    `);
  }
}
