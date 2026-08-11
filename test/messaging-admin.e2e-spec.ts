import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/platform/http/configure-app';
import { MessagingStatus, NatsClient, STREAM_NAME } from './../src/platform/messaging';
import { OutboxRepository } from './../src/platform/outbox';

const PASSWORD = 'correct-horse-battery';

interface DeadLetteredRow {
  id: string;
  name: string;
  attempts: number;
  lastError: string | null;
}

const ok = <T>(res: { body: unknown }): T => (res.body as { data: T }).data;

describe('Messaging admin (e2e — requires Postgres, Redis, NATS + `make migrate-up`)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let outbox: OutboxRepository;
  let nats: NatsClient;
  let auth: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    outbox = app.get(OutboxRepository);
    nats = app.get(NatsClient);
  });

  beforeEach(async () => {
    await nats.manager().streams.purge(STREAM_NAME);
    await dataSource.query('TRUNCATE identity.users RESTART IDENTITY');
    await dataSource.query('TRUNCATE auth.sessions RESTART IDENTITY');
    await dataSource.query('TRUNCATE outbox.events RESTART IDENTITY');
    await dataSource.query('TRUNCATE messaging.dead_letters RESTART IDENTITY');
    await dataSource.query('TRUNCATE messaging.processed_events');
    await dataSource.query('TRUNCATE notification.notifications RESTART IDENTITY');

    await dataSource.query('TRUNCATE rbac.user_roles');

    const registered = await http()
      .post('/api/v1/users')
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(201);

    // Every route here now requires `messaging:admin`. Granted straight into
    // the junction because that is what the boot-time bootstrap does — the
    // route that would assign it already requires the role it is granting.
    await dataSource.query(
      `INSERT INTO rbac.user_roles (user_uuid, role_id)
            SELECT $1, id FROM rbac.roles WHERE name = 'admin'
       ON CONFLICT DO NOTHING`,
      [ok<{ uuid: string }>(registered).uuid],
    );

    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(200);
    auth = `Bearer ${ok<{ accessToken: string }>(login).accessToken}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('is not reachable without authentication', async () => {
    await http().get('/api/v1/admin/messaging/status').expect(401);
    await http().post('/api/v1/admin/messaging/outbox/replay').send({}).expect(401);
  });

  it('reports the outbox backlog including how long the oldest row has waited', async () => {
    // The relay is off in tests, so registration leaves rows pending.
    const status = ok<MessagingStatus>(
      await http().get('/api/v1/admin/messaging/status').set('Authorization', auth).expect(200),
    );

    expect(status.brokerReachable).toBe(true);
    expect(status.outbox.pending).toBeGreaterThan(0);
    expect(status.outbox.deadLettered).toBe(0);
    expect(status.outbox.oldestPendingAgeSeconds).not.toBeNull();
    expect(status.outbox.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('reports per-consumer lag and which subjects each covers', async () => {
    const status = ok<MessagingStatus>(
      await http().get('/api/v1/admin/messaging/status').set('Authorization', auth).expect(200),
    );

    const welcome = status.consumers.find((c) => c.name === 'notification_welcome');
    expect(welcome).toBeDefined();
    expect(welcome?.present).toBe(true);
    expect(welcome?.subjects).toEqual(['identity.user.registered']);
    expect(typeof welcome?.pending).toBe('number');
    expect(welcome?.deadLetters).toBe(0);
    expect(status.stream?.name).toBe(STREAM_NAME);
  });

  it('lists dead-lettered outbox rows with the error that stopped them', async () => {
    const [row] = await dataSource.query<{ id: string }[]>(
      'SELECT id FROM outbox.events ORDER BY id LIMIT 1',
    );
    await dataSource.query('UPDATE outbox.events SET attempts = 5 WHERE id = $1', [row!.id]);
    await outbox.recordFailure(row!.id, 'broker refused the message', 5);

    const rows = ok<DeadLetteredRow[]>(
      await http()
        .get('/api/v1/admin/messaging/outbox/dead-lettered')
        .set('Authorization', auth)
        .expect(200),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('identity.user.registered');
    expect(rows[0]?.lastError).toContain('broker refused');
  });

  it('replays a dead-lettered row and drains it in the same call', async () => {
    const [row] = await dataSource.query<{ id: string }[]>(
      'SELECT id FROM outbox.events ORDER BY id LIMIT 1',
    );
    await dataSource.query('UPDATE outbox.events SET attempts = 5 WHERE id = $1', [row!.id]);
    await outbox.recordFailure(row!.id, 'transient outage', 5);
    expect((await outbox.stats()).deadLettered).toBe(1);

    const result = ok<{ replayed: number; drained: number }>(
      await http()
        .post('/api/v1/admin/messaging/outbox/replay')
        .set('Authorization', auth)
        .send({ ids: [row!.id] })
        .expect(200),
    );

    expect(result.replayed).toBe(1);
    // Drained in the same request rather than leaving the operator waiting for
    // the next tick to find out whether the replay worked.
    expect(result.drained).toBeGreaterThanOrEqual(1);

    const after = await outbox.stats();
    expect(after.deadLettered).toBe(0);
    expect(after.pending).toBe(0);
  });

  it('rejects a non-numeric outbox id rather than passing it to SQL', async () => {
    await http()
      .post('/api/v1/admin/messaging/outbox/replay')
      .set('Authorization', auth)
      .send({ ids: ['1; DROP TABLE outbox.events'] })
      .expect(400);

    // Still there.
    await dataSource.query('SELECT 1 FROM outbox.events LIMIT 1');
  });

  it('discards a consumer dead letter and its processed marker', async () => {
    await dataSource.query(
      `INSERT INTO messaging.dead_letters
         (consumer_name, event_name, idempotency_key, payload, error, delivery_count)
       VALUES ('notification_welcome', 'identity.user.registered',
               '00000000-0000-0000-0000-0000000000ff', '{}'::jsonb, 'handler exploded', 3)`,
    );
    await dataSource.query(
      `INSERT INTO messaging.processed_events (consumer_name, idempotency_key)
       VALUES ('notification_welcome', '00000000-0000-0000-0000-0000000000ff')`,
    );

    const listed = ok<{ consumerName: string; error: string }[]>(
      await http()
        .get('/api/v1/admin/messaging/dead-letters')
        .set('Authorization', auth)
        .expect(200),
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.error).toBe('handler exploded');

    await http()
      .post('/api/v1/admin/messaging/dead-letters/discard')
      .set('Authorization', auth)
      .send({
        consumerName: 'notification_welcome',
        idempotencyKey: '00000000-0000-0000-0000-0000000000ff',
      })
      .expect(204);

    const remaining = await dataSource.query<unknown[]>('SELECT * FROM messaging.dead_letters');
    expect(remaining).toHaveLength(0);

    // The marker goes too, so a redelivery is handled afresh instead of being
    // skipped as already processed.
    const markers = await dataSource.query<unknown[]>('SELECT * FROM messaging.processed_events');
    expect(markers).toHaveLength(0);
  });
});
