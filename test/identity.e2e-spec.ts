import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/platform/http/configure-app';

const PASSWORD = 'correct-horse-battery';

interface UserBody {
  uuid: string;
  email: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface PageBody {
  items: UserBody[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details: { field: string }[] };
  path: string;
}

const ok = <T>(res: { body: unknown }): T => (res.body as { data: T }).data;
const fail = (res: { body: unknown }): ErrorBody => res.body as ErrorBody;

describe('Identity (e2e — requires Postgres + `make migrate-up`)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const register = (email: string) =>
    request(app.getHttpServer()).post('/api/users').send({ email, password: PASSWORD });

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a user and never returns the password hash', async () => {
    const response = await register('ada@example.com').expect(201);
    const user = ok<UserBody>(response);

    expect(user.email).toBe('ada@example.com');
    expect(user.status).toBe('PENDING');
    expect(user.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('$argon2');
  });

  it('rejects a duplicate address with the domain error code', async () => {
    await register('ada@example.com').expect(201);

    const response = await register('ADA@example.com').expect(409);

    expect(fail(response).error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('reports validation failures through the same envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/users')
      .send({ email: 'nope', password: 'short' })
      .expect(400);

    const body = fail(response);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.map((d) => d.field).sort()).toEqual(['email', 'password']);
  });

  it('refuses an unknown property rather than silently accepting it', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/users')
      .send({ email: 'ada@example.com', password: PASSWORD, status: 'ACTIVE' })
      .expect(400);

    expect(fail(response).error.code).toBe('VALIDATION_FAILED');
  });

  it('fetches, updates and lists users', async () => {
    const created = ok<UserBody>(await register('ada@example.com').expect(201));

    const fetched = ok<UserBody>(
      await request(app.getHttpServer()).get(`/api/users/${created.uuid}`).expect(200),
    );
    expect(fetched.email).toBe('ada@example.com');

    const updated = ok<UserBody>(
      await request(app.getHttpServer())
        .patch(`/api/users/${created.uuid}`)
        .send({ status: 'ACTIVE', email: 'grace@example.com' })
        .expect(200),
    );
    expect(updated.status).toBe('ACTIVE');
    expect(updated.email).toBe('grace@example.com');

    await register('ada@example.com').expect(201);

    const page = ok<PageBody>(
      await request(app.getHttpServer()).get('/api/users?limit=1').expect(200),
    );
    expect(page).toMatchObject({ total: 2, limit: 1, totalPages: 2 });
    expect(page.items).toHaveLength(1);
  });

  it('hides a soft-deleted user and frees its address for reuse', async () => {
    const created = ok<UserBody>(await register('ada@example.com').expect(201));

    await request(app.getHttpServer()).delete(`/api/users/${created.uuid}`).expect(204);

    const missing = await request(app.getHttpServer())
      .get(`/api/users/${created.uuid}`)
      .expect(404);
    expect(fail(missing).error.code).toBe('USER_NOT_FOUND');

    // The unique index is partial, so the address is available again.
    await register('ada@example.com').expect(201);
  });

  it('keeps the internal BIGSERIAL out of every response', async () => {
    const user = ok<UserBody>(await register('ada@example.com').expect(201));

    expect(Object.keys(user).sort()).toEqual(['createdAt', 'email', 'status', 'updatedAt', 'uuid']);
  });

  it('rejects a non-uuid path parameter before reaching the handler', async () => {
    await request(app.getHttpServer()).get('/api/users/not-a-uuid').expect(400);
  });
});
