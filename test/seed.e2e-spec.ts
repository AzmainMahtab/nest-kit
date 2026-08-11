import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import {
  RbacSeeder,
  SEED_PERMISSIONS,
  SEED_ROLES,
  SuperAdminSeeder,
} from './../src/database/seeds';
import { UserRepository } from './../src/modules/identity';
import { RbacRepository } from './../src/modules/rbac';
import { configureApp } from './../src/platform/http/configure-app';
import { NatsClient, STREAM_NAME } from './../src/platform/messaging';
import { Clock, EventBus, Hasher, UnitOfWork } from './../src/shared/application';

const EMAIL = 'seeded-admin@example.com';
const PASSWORD = 'correct-horse-battery';

interface RoleRow {
  name: string;
  is_protected: boolean;
  perms: string;
}

const ok = <T>(res: { body: unknown }): T => (res.body as { data: T }).data;

describe('Seeds (e2e — requires Postgres, Redis, NATS + `make migrate-up`)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let nats: NatsClient;
  let catalogue: RbacSeeder;
  let superadmin: SuperAdminSeeder;

  const http = () => request(app.getHttpServer());

  // Not async: supertest's chainable `.expect()` lives on the Test object, and
  // wrapping it in a promise would hand back something that only has `.then`.
  const login = (password: string) =>
    http().post('/api/v1/auth/login').send({ email: EMAIL, password });

  const roles = () =>
    dataSource.query<RoleRow[]>(
      `SELECT r.name, r.is_protected, count(rp.permission_id) AS perms
         FROM rbac.roles r
         LEFT JOIN rbac.role_permissions rp ON rp.role_id = r.id
        GROUP BY r.name, r.is_protected
        ORDER BY r.name`,
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

    // Constructed exactly as scripts/seed.ts does, so the test exercises the
    // wiring the command actually uses rather than a convenient stand-in.
    catalogue = new RbacSeeder(
      app.get(RbacRepository),
      app.get(EventBus),
      app.get(UnitOfWork),
      app.get(Clock),
    );

    superadmin = new SuperAdminSeeder(
      app.get(UserRepository),
      app.get(RbacRepository),
      app.get(Hasher),
      app.get(EventBus),
      app.get(UnitOfWork),
      app.get(Clock),
    );
  });

  beforeEach(async () => {
    await nats.manager().streams.purge(STREAM_NAME);
    await dataSource.query('TRUNCATE rbac.user_roles');
    // `admin` is protected and migration-seeded, so it stays; everything the
    // seed would create is removed to prove it gets recreated.
    await dataSource.query('DELETE FROM rbac.roles WHERE is_protected = FALSE');
    await dataSource.query('TRUNCATE identity.users RESTART IDENTITY CASCADE');
    await dataSource.query('TRUNCATE auth.sessions RESTART IDENTITY');
    await dataSource.query('TRUNCATE outbox.events RESTART IDENTITY');
    await dataSource.query('TRUNCATE messaging.processed_events');
    await dataSource.query('TRUNCATE messaging.dead_letters RESTART IDENTITY');
    await dataSource.query('TRUNCATE notification.notifications RESTART IDENTITY');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the rbac catalogue', () => {
    it('creates every catalogued role, with only its own permissions', async () => {
      await catalogue.run();

      const byName = new Map((await roles()).map((row) => [row.name, row]));

      for (const wanted of SEED_ROLES) {
        expect(byName.get(wanted.name)).toMatchObject({
          is_protected: wanted.isProtected,
          perms: String(wanted.permissions.length),
        });
      }
    });

    it('leaves the protected admin role holding the whole catalogue', async () => {
      await catalogue.run();

      const admin = (await roles()).find((row) => row.name === 'admin');

      expect(admin).toMatchObject({
        is_protected: true,
        perms: String(SEED_PERMISSIONS.length),
      });
    });

    it('writes nothing on a second run', async () => {
      await catalogue.run();
      const before = await roles();

      const report = await catalogue.run();

      expect(report).toEqual({ permissionsCreated: [], rolesCreated: [], permissionsGranted: [] });
      expect(await roles()).toEqual(before);
    });

    it('extends a role that predates the catalogue instead of replacing it', async () => {
      await catalogue.run();
      // Strip auditor back to nothing, as if it had been created before
      // `rbac:read` was catalogued.
      await dataSource.query(`
        DELETE FROM rbac.role_permissions
         WHERE role_id = (SELECT id FROM rbac.roles WHERE name = 'auditor')
      `);

      const report = await catalogue.run();

      expect(report.rolesCreated).not.toContain('auditor');
      expect(report.permissionsGranted).toContain('auditor -> rbac:read');
      expect((await roles()).find((row) => row.name === 'auditor')?.perms).toBe('1');
    });
  });

  describe('the superadmin', () => {
    it('provisions an account that can log in and administer roles', async () => {
      await catalogue.run();

      const report = await superadmin.run(EMAIL, PASSWORD);

      expect(report.userCreated).toBe(true);
      expect(report.roleAssigned).toBe(true);

      // The whole point: the seeded account is usable end to end, without
      // anyone touching the database by hand.
      const session = await login(PASSWORD).expect(200);
      const auth = `Bearer ${ok<{ accessToken: string }>(session).accessToken}`;

      await http().get('/api/v1/rbac/roles').set('Authorization', auth).expect(200);
      await http().get('/api/v1/admin/messaging/status').set('Authorization', auth).expect(200);
    });

    it('does not reset the password of an account that already exists', async () => {
      await catalogue.run();
      await superadmin.run(EMAIL, PASSWORD);

      const report = await superadmin.run(EMAIL, 'a-totally-different-password');

      expect(report).toMatchObject({ userCreated: false, roleAssigned: false });
      await login(PASSWORD).expect(200);
      await login('a-totally-different-password').expect(401);
    });

    it('refuses to run before the catalogue exists', async () => {
      await dataSource.query("DELETE FROM rbac.roles WHERE name = 'admin'");

      await expect(superadmin.run(EMAIL, PASSWORD)).rejects.toThrow(/no 'admin' role/);

      // Restore what the migration seeded, for the suites that follow.
      await catalogue.run();
    });
  });
});
