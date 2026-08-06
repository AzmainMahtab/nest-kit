import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/platform/http/configure-app';
import { NatsClient, STREAM_NAME } from './../src/platform/messaging';

const PASSWORD = 'correct-horse-battery';

/** Seeded by the CreateRbac migration. Kept in sync with what the routes require. */
const SEEDED_PERMISSIONS = ['messaging:admin', 'rbac:admin', 'rbac:read'];

interface UserBody {
  uuid: string;
}
interface RoleBody {
  uuid: string;
  name: string;
  isProtected: boolean;
  permissions: string[];
}
interface PermissionBody {
  uuid: string;
  name: string;
  resource: string;
  action: string;
}
interface GrantsBody {
  roles: string[];
  permissions: string[];
}
interface PageBody<T> {
  items: T[];
  total: number;
}
interface AssignmentBody {
  role: RoleBody;
  assignedBy: string | null;
}
interface ErrorBody {
  success: false;
  error: { code: string };
}

const ok = <T>(res: { body: unknown }): T => (res.body as { data: T }).data;
const fail = (res: { body: unknown }): ErrorBody => res.body as ErrorBody;

describe('RBAC (e2e — requires Postgres, Redis, NATS + `make migrate-up`)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let nats: NatsClient;

  // An ordinary authenticated user, holding no roles at all.
  let plainUuid: string;
  let plain: string;
  // A user holding the seeded `admin` role, the way the boot-time bootstrap
  // would have left them.
  let adminUuid: string;
  let admin: string;

  const http = () => request(app.getHttpServer());

  const register = async (email: string): Promise<string> => {
    const res = await http().post('/api/users').send({ email, password: PASSWORD }).expect(201);
    return ok<UserBody>(res).uuid;
  };

  const login = async (email: string): Promise<string> => {
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return `Bearer ${ok<{ accessToken: string }>(res).accessToken}`;
  };

  /**
   * Straight into the junction table, on purpose: this is what the config-driven
   * bootstrap does on boot, and it is the only way to get the first admin —
   * every route that could assign the role already requires it.
   */
  const grantAdminRole = async (userUuid: string): Promise<void> => {
    await dataSource.query(
      `INSERT INTO rbac.user_roles (user_uuid, role_id)
            SELECT $1, id FROM rbac.roles WHERE name = 'admin'
       ON CONFLICT DO NOTHING`,
      [userUuid],
    );
  };

  const createRole = async (name: string): Promise<RoleBody> =>
    ok<RoleBody>(
      await http()
        .post('/api/rbac/roles')
        .set('Authorization', admin)
        .send({ name, description: 'created by a test' })
        .expect(201),
    );

  const createPermission = async (name: string): Promise<PermissionBody> =>
    ok<PermissionBody>(
      await http()
        .post('/api/rbac/permissions')
        .set('Authorization', admin)
        .send({ name })
        .expect(201),
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    nats = app.get(NatsClient);
  });

  beforeEach(async () => {
    await nats.manager().streams.purge(STREAM_NAME);
    await dataSource.query('TRUNCATE rbac.user_roles');
    // The seeded catalogue is part of the schema, so only what a test added is
    // removed. Deleting a role cascades to its grants.
    await dataSource.query('DELETE FROM rbac.roles WHERE is_protected = FALSE');
    await dataSource.query('DELETE FROM rbac.permissions WHERE name <> ALL($1)', [
      SEEDED_PERMISSIONS,
    ]);
    await dataSource.query('TRUNCATE identity.users RESTART IDENTITY CASCADE');
    await dataSource.query('TRUNCATE auth.sessions RESTART IDENTITY');
    await dataSource.query('TRUNCATE outbox.events RESTART IDENTITY');
    await dataSource.query('TRUNCATE messaging.processed_events');
    await dataSource.query('TRUNCATE notification.notifications RESTART IDENTITY');

    plainUuid = await register('plain@example.com');
    plain = await login('plain@example.com');

    adminUuid = await register('root@example.com');
    await grantAdminRole(adminUuid);
    admin = await login('root@example.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the seeded catalogue', () => {
    it('ships every permission the routes actually require', async () => {
      const page = ok<PageBody<PermissionBody>>(
        await http()
          .get('/api/rbac/permissions')
          .set('Authorization', admin)
          .query({ limit: 100 })
          .expect(200),
      );

      // Guards against the one failure this design cannot catch at compile
      // time: a route naming a permission the migration never seeded, which
      // would make it unreachable by anyone.
      expect(page.items.map((p) => p.name)).toEqual(expect.arrayContaining(SEEDED_PERMISSIONS));
    });

    it('splits a permission name into its resource and action', async () => {
      const page = ok<PageBody<PermissionBody>>(
        await http()
          .get('/api/rbac/permissions')
          .set('Authorization', admin)
          .query({ limit: 100 })
          .expect(200),
      );

      expect(page.items.find((p) => p.name === 'messaging:admin')).toMatchObject({
        resource: 'messaging',
        action: 'admin',
      });
    });

    it('marks the admin role protected so it cannot lose rbac:admin', async () => {
      const page = ok<PageBody<RoleBody>>(
        await http().get('/api/rbac/roles').set('Authorization', admin).expect(200),
      );
      const adminRole = page.items.find((r) => r.name === 'admin');

      expect(adminRole).toMatchObject({ isProtected: true });
      expect(adminRole?.permissions).toEqual(expect.arrayContaining(SEEDED_PERMISSIONS));
    });
  });

  describe('the messaging admin API', () => {
    it('is still closed to an unauthenticated caller', async () => {
      await http().get('/api/admin/messaging/status').expect(401);
    });

    it('refuses a merely authenticated user', async () => {
      // The hole this feature exists to close: before RBAC, any logged-in user
      // could replay and discard events.
      const res = await http()
        .get('/api/admin/messaging/status')
        .set('Authorization', plain)
        .expect(403);

      expect(fail(res).error.code).toBe('FORBIDDEN');
    });

    it('refuses a merely authenticated user on the write routes too', async () => {
      await http()
        .post('/api/admin/messaging/outbox/replay')
        .set('Authorization', plain)
        .send({})
        .expect(403);

      await http()
        .post('/api/admin/messaging/dead-letters/discard')
        .set('Authorization', plain)
        .send({ consumerName: 'x', idempotencyKey: '00000000-0000-0000-0000-000000000000' })
        .expect(403);
    });

    it('admits a holder of messaging:admin', async () => {
      await http().get('/api/admin/messaging/status').set('Authorization', admin).expect(200);
    });
  });

  describe('administering roles', () => {
    it('refuses a non-admin every write route', async () => {
      await http()
        .post('/api/rbac/roles')
        .set('Authorization', plain)
        .send({ name: 'sneaky' })
        .expect(403);

      await http()
        .post('/api/rbac/permissions')
        .set('Authorization', plain)
        .send({ name: 'sneaky:everything' })
        .expect(403);

      await http()
        .post(`/api/rbac/users/${plainUuid}/roles`)
        .set('Authorization', plain)
        .send({ roleUuid: '00000000-0000-0000-0000-000000000000' })
        .expect(403);
    });

    it('creates a role, grants it a permission and reports both', async () => {
      const permission = await createPermission('billing:refund');
      const role = await createRole('support-agent');

      const updated = ok<RoleBody>(
        await http()
          .post(`/api/rbac/roles/${role.uuid}/permissions`)
          .set('Authorization', admin)
          .send({ permission: permission.name })
          .expect(201),
      );

      expect(updated.permissions).toEqual(['billing:refund']);
    });

    it('rejects a permission name that is not resource:action', async () => {
      const res = await http()
        .post('/api/rbac/permissions')
        .set('Authorization', admin)
        .send({ name: 'Billing Refund' })
        .expect(400);

      expect(fail(res).error.code).toBe('INVALID_PERMISSION_NAME');
    });

    it('rejects a duplicate role name', async () => {
      await createRole('support-agent');

      const res = await http()
        .post('/api/rbac/roles')
        .set('Authorization', admin)
        .send({ name: 'support-agent' })
        .expect(409);

      expect(fail(res).error.code).toBe('ROLE_ALREADY_EXISTS');
    });

    it('refuses to change the protected admin role', async () => {
      const page = ok<PageBody<RoleBody>>(
        await http().get('/api/rbac/roles').set('Authorization', admin).expect(200),
      );
      const adminRole = page.items.find((r) => r.name === 'admin');

      const res = await http()
        .delete(`/api/rbac/roles/${adminRole?.uuid}/permissions/rbac:admin`)
        .set('Authorization', admin)
        .expect(409);

      expect(fail(res).error.code).toBe('ROLE_IS_PROTECTED');
    });

    it('refuses to assign a role to a user that does not exist', async () => {
      const role = await createRole('support-agent');

      const res = await http()
        .post('/api/rbac/users/00000000-0000-0000-0000-000000000000/roles')
        .set('Authorization', admin)
        .send({ roleUuid: role.uuid })
        .expect(400);

      expect(fail(res).error.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('assignment and its effect on access', () => {
    it('takes effect immediately, without waiting for the cache to expire', async () => {
      // The plain user's empty grants are cached by this first 403.
      await http().get('/api/rbac/roles').set('Authorization', plain).expect(403);

      const role = await createRole('auditor');
      await http()
        .post(`/api/rbac/roles/${role.uuid}/permissions`)
        .set('Authorization', admin)
        .send({ permission: 'rbac:read' })
        .expect(201);
      await http()
        .post(`/api/rbac/users/${plainUuid}/roles`)
        .set('Authorization', admin)
        .send({ roleUuid: role.uuid })
        .expect(204);

      // With RBAC_CACHE_TTL_SECONDS at 300 in the e2e setup, this can only pass
      // if the assignment evicted the cached entry.
      await http().get('/api/rbac/roles').set('Authorization', plain).expect(200);
    });

    it('revokes access as soon as the role is taken away', async () => {
      const role = await createRole('auditor');
      await http()
        .post(`/api/rbac/roles/${role.uuid}/permissions`)
        .set('Authorization', admin)
        .send({ permission: 'rbac:read' })
        .expect(201);
      await http()
        .post(`/api/rbac/users/${plainUuid}/roles`)
        .set('Authorization', admin)
        .send({ roleUuid: role.uuid })
        .expect(204);
      await http().get('/api/rbac/roles').set('Authorization', plain).expect(200);

      await http()
        .delete(`/api/rbac/users/${plainUuid}/roles/${role.uuid}`)
        .set('Authorization', admin)
        .expect(204);

      await http().get('/api/rbac/roles').set('Authorization', plain).expect(403);
    });

    it('propagates a permission granted to a role the user already holds', async () => {
      const role = await createRole('auditor');
      await http()
        .post(`/api/rbac/users/${plainUuid}/roles`)
        .set('Authorization', admin)
        .send({ roleUuid: role.uuid })
        .expect(204);
      await http().get('/api/rbac/roles').set('Authorization', plain).expect(403);

      // Nothing about the *user* changed here — only the role — so this passes
      // only if the invalidation expanded the role to its holders.
      await http()
        .post(`/api/rbac/roles/${role.uuid}/permissions`)
        .set('Authorization', admin)
        .send({ permission: 'rbac:read' })
        .expect(201);

      await http().get('/api/rbac/roles').set('Authorization', plain).expect(200);
    });

    it('is idempotent and keeps the original audit trail', async () => {
      const role = await createRole('auditor');

      await http()
        .post(`/api/rbac/users/${plainUuid}/roles`)
        .set('Authorization', admin)
        .send({ roleUuid: role.uuid })
        .expect(204);
      await http()
        .post(`/api/rbac/users/${plainUuid}/roles`)
        .set('Authorization', admin)
        .send({ roleUuid: role.uuid })
        .expect(204);

      const assignments = ok<AssignmentBody[]>(
        await http()
          .get(`/api/rbac/users/${plainUuid}/roles`)
          .set('Authorization', admin)
          .expect(200),
      );

      expect(assignments).toHaveLength(1);
      expect(assignments[0]?.assignedBy).toBe(adminUuid);
    });
  });

  describe('grants', () => {
    it('lets any authenticated caller read their own, with no permission', async () => {
      const grants = ok<GrantsBody>(
        await http().get('/api/rbac/me/grants').set('Authorization', plain).expect(200),
      );

      expect(grants).toEqual({ roles: [], permissions: [] });
    });

    it("reports the admin's roles and effective permissions", async () => {
      const grants = ok<GrantsBody>(
        await http().get('/api/rbac/me/grants').set('Authorization', admin).expect(200),
      );

      expect(grants.roles).toEqual(['admin']);
      expect(grants.permissions).toEqual(expect.arrayContaining(SEEDED_PERMISSIONS));
    });

    it("refuses a non-admin reading someone else's", async () => {
      await http()
        .get(`/api/rbac/users/${adminUuid}/grants`)
        .set('Authorization', plain)
        .expect(403);
    });

    it('deduplicates a permission reached through two roles', async () => {
      const permission = await createPermission('billing:refund');

      for (const name of ['auditor', 'support-agent']) {
        const role = await createRole(name);
        await http()
          .post(`/api/rbac/roles/${role.uuid}/permissions`)
          .set('Authorization', admin)
          .send({ permission: permission.name })
          .expect(201);
        await http()
          .post(`/api/rbac/users/${plainUuid}/roles`)
          .set('Authorization', admin)
          .send({ roleUuid: role.uuid })
          .expect(204);
      }

      const grants = ok<GrantsBody>(
        await http().get('/api/rbac/me/grants').set('Authorization', plain).expect(200),
      );

      expect(grants.roles.sort()).toEqual(['auditor', 'support-agent']);
      expect(grants.permissions).toEqual(['billing:refund']);
    });

    it('reports a role that grants nothing, without inventing a permission', async () => {
      const role = await createRole('bare');
      await http()
        .post(`/api/rbac/users/${plainUuid}/roles`)
        .set('Authorization', admin)
        .send({ roleUuid: role.uuid })
        .expect(204);

      const grants = ok<GrantsBody>(
        await http().get('/api/rbac/me/grants').set('Authorization', plain).expect(200),
      );

      expect(grants).toEqual({ roles: ['bare'], permissions: [] });
    });
  });
});
