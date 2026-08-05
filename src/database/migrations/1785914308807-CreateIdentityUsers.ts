import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIdentityUsers1785914308807 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // One schema per bounded context — it makes the extraction cut line visible
    // in the database itself (AGENTS.md §10).
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS identity');

    await queryRunner.query(`
      CREATE TABLE identity.users (
          id             BIGSERIAL PRIMARY KEY,
          uuid           UUID NOT NULL UNIQUE,
          email          VARCHAR(254) NOT NULL,
          password_hash  TEXT NOT NULL,
          status         VARCHAR(32) NOT NULL,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at     TIMESTAMPTZ
      )
    `);

    // Uniqueness applies to live rows only, so a soft-deleted account does not
    // permanently reserve its address.
    await queryRunner.query(`
      CREATE UNIQUE INDEX users_email_key
          ON identity.users (email)
       WHERE deleted_at IS NULL
    `);

    // No index on uuid: the UNIQUE constraint already creates a btree, and a
    // second one is pure write and disk overhead (AGENTS.md §10).
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE identity.users');
    await queryRunner.query('DROP SCHEMA IF EXISTS identity');
  }
}
