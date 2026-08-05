import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/platform/http/configure-app';

const PASSWORD = 'correct-horse-battery';

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string };
}

const ok = <T>(res: { body: unknown }): T => (res.body as { data: T }).data;
const fail = (res: { body: unknown }): ErrorBody => res.body as ErrorBody;

describe('Auth (e2e — requires Postgres, Redis, NATS and `make migrate-up`)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const http = () => request(app.getHttpServer());

  const registerAndLogin = async (email: string): Promise<Tokens> => {
    await http().post('/api/users').send({ email, password: PASSWORD }).expect(201);
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return ok<Tokens>(res);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE identity.users RESTART IDENTITY');
    await dataSource.query('TRUNCATE auth.sessions RESTART IDENTITY');
    await dataSource.query('TRUNCATE outbox.events RESTART IDENTITY');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('access control', () => {
    it('denies an unauthenticated request by default', async () => {
      const res = await http().get('/api/users').expect(401);

      expect(fail(res).error.code).toBe('MISSING_TOKEN');
    });

    it('leaves registration, login and health public', async () => {
      await http()
        .post('/api/users')
        .send({ email: 'ada@example.com', password: PASSWORD })
        .expect(201);
      await http().get('/health').expect(200);
      await http()
        .post('/api/auth/login')
        .send({ email: 'ada@example.com', password: PASSWORD })
        .expect(200);
    });

    it('accepts a bearer token', async () => {
      const tokens = await registerAndLogin('ada@example.com');

      await http()
        .get('/api/users')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);
    });

    it('rejects a malformed or unsigned token', async () => {
      await http().get('/api/users').set('Authorization', 'Bearer not-a-token').expect(401);
      await http().get('/api/users').set('Authorization', 'Basic abc').expect(401);
    });

    it('rejects a refresh token used as an access token', async () => {
      const tokens = await registerAndLogin('ada@example.com');

      const res = await http()
        .get('/api/users')
        .set('Authorization', `Bearer ${tokens.refreshToken}`)
        .expect(401);

      expect(fail(res).error.code).toBe('WRONG_TOKEN_TYPE');
    });
  });

  describe('login', () => {
    it('is deliberately vague about which half was wrong', async () => {
      await http()
        .post('/api/users')
        .send({ email: 'ada@example.com', password: PASSWORD })
        .expect(201);

      const wrongPassword = await http()
        .post('/api/auth/login')
        .send({ email: 'ada@example.com', password: 'not-the-password' })
        .expect(401);

      const unknownUser = await http()
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: PASSWORD })
        .expect(401);

      // Identical code and message: the endpoint must not be a user-enumeration
      // oracle.
      expect(fail(wrongPassword).error).toEqual(fail(unknownUser).error);
      expect(fail(wrongPassword).error.code).toBe('INVALID_CREDENTIALS');
    });

    it('refuses a suspended account', async () => {
      const tokens = await registerAndLogin('ada@example.com');
      const users = await http()
        .get('/api/users')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);
      const uuid = ok<{ items: { uuid: string }[] }>(users).items[0]!.uuid;

      await http()
        .patch(`/api/users/${uuid}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ status: 'SUSPENDED' })
        .expect(200);

      const res = await http()
        .post('/api/auth/login')
        .send({ email: 'ada@example.com', password: PASSWORD })
        .expect(403);

      expect(fail(res).error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('records a session row', async () => {
      await registerAndLogin('ada@example.com');

      const sessions = await dataSource.query<{ revoked_at: Date | null }[]>(
        'SELECT * FROM auth.sessions',
      );
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.revoked_at).toBeNull();
    });
  });

  describe('refresh rotation', () => {
    it('issues a new pair and invalidates the presented refresh token', async () => {
      const first = await registerAndLogin('ada@example.com');

      const res = await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);
      const second = ok<Tokens>(res);

      expect(second.refreshToken).not.toBe(first.refreshToken);

      // The new one works.
      await http()
        .get('/api/users')
        .set('Authorization', `Bearer ${second.accessToken}`)
        .expect(200);
    });

    it('revokes the whole session when a used refresh token is replayed', async () => {
      const first = await registerAndLogin('ada@example.com');

      const second = ok<Tokens>(
        await http()
          .post('/api/auth/refresh')
          .send({ refreshToken: first.refreshToken })
          .expect(200),
      );

      // Replay of the superseded token: the legitimate client has moved on, so
      // this is a stolen token.
      const replay = await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      expect(fail(replay).error.code).toBe('REFRESH_TOKEN_REPLAYED');

      // The attacker's newer token is dead too — the session itself is revoked.
      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: second.refreshToken })
        .expect(401);

      const sessions = await dataSource.query<{ revoked_at: Date | null }[]>(
        'SELECT * FROM auth.sessions',
      );
      expect(sessions[0]?.revoked_at).not.toBeNull();
    });
  });

  describe('logout', () => {
    it('blacklists the access token so it stops working immediately', async () => {
      const tokens = await registerAndLogin('ada@example.com');

      await http()
        .get('/api/users')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      await http()
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(204);

      // Still cryptographically valid and unexpired — only the blacklist stops it.
      const res = await http()
        .get('/api/users')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(401);
      expect(fail(res).error.code).toBe('TOKEN_REVOKED');
    });

    it('ends the session so the refresh token cannot revive it', async () => {
      const tokens = await registerAndLogin('ada@example.com');

      await http()
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(204);

      await http()
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);
    });

    it('requires authentication', async () => {
      await http().post('/api/auth/logout').expect(401);
    });
  });
});
