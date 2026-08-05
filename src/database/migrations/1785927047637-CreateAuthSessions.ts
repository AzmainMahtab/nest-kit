import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthSessions1785927047637 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS auth');

    await queryRunner.query(`
      CREATE TABLE auth.sessions (
          id           BIGSERIAL PRIMARY KEY,
          uuid         UUID NOT NULL UNIQUE,
          user_uuid    UUID NOT NULL,
          refresh_jti  UUID NOT NULL,
          issued_at    TIMESTAMPTZ NOT NULL,
          expires_at   TIMESTAMPTZ NOT NULL,
          revoked_at   TIMESTAMPTZ
      )
    `);

    // "Revoke everything for this user" is the hot path on a password change or
    // a breach, and it only ever looks at live sessions.
    await queryRunner.query(`
      CREATE INDEX sessions_active_user_idx
          ON auth.sessions (user_uuid)
       WHERE revoked_at IS NULL
    `);

    // user_uuid is an id, not a foreign key: identity owns its table and a
    // cross-schema FK would have to be dropped before either context could be
    // extracted (AGENTS.md §13).
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE auth.sessions');
    await queryRunner.query('DROP SCHEMA IF EXISTS auth');
  }
}
