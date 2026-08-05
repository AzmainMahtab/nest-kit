import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOwnerAndCar1785930944056 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS owner');

    await queryRunner.query(`
      CREATE TABLE owner.owners (
          id             BIGSERIAL PRIMARY KEY,
          uuid           UUID NOT NULL UNIQUE,
          user_uuid      UUID NOT NULL UNIQUE,
          address        VARCHAR(512) NOT NULL,
          date_of_birth  DATE NOT NULL,
          status         VARCHAR(32) NOT NULL,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS car');

    await queryRunner.query(`
      CREATE TABLE car.cars (
          id              BIGSERIAL PRIMARY KEY,
          uuid            UUID NOT NULL UNIQUE,
          owner_uuid      UUID NOT NULL,
          make            VARCHAR(64) NOT NULL,
          model           VARCHAR(64) NOT NULL,
          year            INTEGER NOT NULL,
          colour          VARCHAR(32) NOT NULL,
          license_plate   VARCHAR(16) NOT NULL UNIQUE,
          -- NUMERIC, not double precision: a price is not something to be
          -- approximately right about (AGENTS.md §7).
          price_amount    NUMERIC(12, 2) NOT NULL,
          price_currency  CHAR(3) NOT NULL,
          status          VARCHAR(32) NOT NULL,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // "Every active car for this owner" is the query the deactivation reaction
    // runs, so the index covers exactly that and nothing else.
    await queryRunner.query(`
      CREATE INDEX cars_active_owner_idx
          ON car.cars (owner_uuid)
       WHERE status = 'ACTIVE'
    `);

    await queryRunner.query('CREATE INDEX cars_owner_idx ON car.cars (owner_uuid)');

    // owner.user_uuid and car.owner_uuid are ids, not foreign keys. A
    // cross-schema FK would have to be dropped before any of identity, owner or
    // car could be extracted, and it is the coupling this architecture exists
    // to avoid (AGENTS.md §13). Referential integrity is enforced in the use
    // case, which checks the other context's port before writing.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE car.cars');
    await queryRunner.query('DROP SCHEMA IF EXISTS car');
    await queryRunner.query('DROP TABLE owner.owners');
    await queryRunner.query('DROP SCHEMA IF EXISTS owner');
  }
}
