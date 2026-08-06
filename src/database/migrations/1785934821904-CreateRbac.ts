import { MigrationInterface, QueryRunner } from 'typeorm';
import { uuidv7 } from 'uuidv7';

/**
 * The permissions the application ships with. Adding one here is not enough on
 * its own — a route has to require it and a role has to hold it.
 */
const PERMISSIONS: [name: string, description: string][] = [
  ['rbac:admin', 'Create roles and permissions, and assign them'],
  ['rbac:read', 'Read roles, permissions and assignments'],
  ['messaging:admin', 'Inspect, replay and discard events in the messaging pipeline'],
];

export class CreateRbac1785934821904 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS rbac');

    await queryRunner.query(`
      CREATE TABLE rbac.permissions (
          id           BIGSERIAL PRIMARY KEY,
          uuid         UUID NOT NULL UNIQUE,
          name         VARCHAR(128) NOT NULL UNIQUE,
          resource     VARCHAR(64) NOT NULL,
          action       VARCHAR(64) NOT NULL,
          description  VARCHAR(255) NOT NULL DEFAULT '',
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // "Every permission on this resource" is the query an admin UI runs to
    // build its permission picker.
    await queryRunner.query('CREATE INDEX permissions_resource_idx ON rbac.permissions (resource)');

    await queryRunner.query(`
      CREATE TABLE rbac.roles (
          id            BIGSERIAL PRIMARY KEY,
          uuid          UUID NOT NULL UNIQUE,
          name          VARCHAR(64) NOT NULL UNIQUE,
          description   VARCHAR(255) NOT NULL DEFAULT '',
          is_protected  BOOLEAN NOT NULL DEFAULT FALSE,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Junctions carry no uuid: their identity is the pair, and a surrogate key
    // would add an index nothing reads. Same shape as messaging.processed_events.
    await queryRunner.query(`
      CREATE TABLE rbac.role_permissions (
          role_id        BIGINT NOT NULL REFERENCES rbac.roles (id) ON DELETE CASCADE,
          permission_id  BIGINT NOT NULL REFERENCES rbac.permissions (id) ON DELETE CASCADE,
          granted_by     UUID,
          granted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (role_id, permission_id)
      )
    `);

    // The primary key already serves lookups by role_id; this one serves the
    // reverse, "which roles grant this permission".
    await queryRunner.query(`
      CREATE INDEX role_permissions_permission_idx
          ON rbac.role_permissions (permission_id)
    `);

    // user_uuid is an id, not a foreign key: identity owns the users table, and
    // a cross-schema FK would have to be dropped before either context could be
    // extracted (AGENTS.md §13). role_id is a real FK — the role is in this
    // schema, so cascading a role deletion is this context's own business.
    await queryRunner.query(`
      CREATE TABLE rbac.user_roles (
          user_uuid    UUID NOT NULL,
          role_id      BIGINT NOT NULL REFERENCES rbac.roles (id) ON DELETE CASCADE,
          assigned_by  UUID,
          assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_uuid, role_id)
      )
    `);

    // Leading column of the primary key covers the authorization hot path
    // (everything for one user); this covers the invalidation path (every user
    // holding one role).
    await queryRunner.query('CREATE INDEX user_roles_role_idx ON rbac.user_roles (role_id)');

    for (const [name, description] of PERMISSIONS) {
      const [resource, action] = name.split(':');

      await queryRunner.query(
        `INSERT INTO rbac.permissions (uuid, name, resource, action, description)
              VALUES ($1, $2, $3, $4, $5)`,
        [uuidv7(), name, resource, action, description],
      );
    }

    // Protected: it is the only role seeded with rbac:admin, so allowing that
    // grant to be revoked would lock every administrator out of the endpoint
    // that could grant it back (see Role.assertNotProtected).
    await queryRunner.query(
      `INSERT INTO rbac.roles (uuid, name, description, is_protected)
            VALUES ($1, 'admin', 'Full administrative access', TRUE)`,
      [uuidv7()],
    );

    await queryRunner.query(`
      INSERT INTO rbac.role_permissions (role_id, permission_id)
           SELECT r.id, p.id
             FROM rbac.roles r
             CROSS JOIN rbac.permissions p
            WHERE r.name = 'admin'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE rbac.user_roles');
    await queryRunner.query('DROP TABLE rbac.role_permissions');
    await queryRunner.query('DROP TABLE rbac.roles');
    await queryRunner.query('DROP TABLE rbac.permissions');
    await queryRunner.query('DROP SCHEMA IF EXISTS rbac');
  }
}
