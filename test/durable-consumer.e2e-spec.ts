import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { NotificationRepository } from './../src/modules/notification';
import { AppConfig } from './../src/platform/config';
import { configureApp } from './../src/platform/http/configure-app';
import {
  DeadLetterRepository,
  DurableConsumerService,
  NatsClient,
  STREAM_NAME,
} from './../src/platform/messaging';
import { OutboxRelay } from './../src/platform/outbox';

const PASSWORD = 'correct-horse-battery';

interface NotificationRow {
  uuid: string;
  recipient_uuid: string;
  subject: string;
  body: string;
}

describe('Durable consumer (e2e — requires Postgres, NATS and `make migrate-up`)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let relay: OutboxRelay;
  let consumers: DurableConsumerService;
  let deadLetters: DeadLetterRepository;
  let nats: NatsClient;

  const register = (email: string) =>
    request(app.getHttpServer()).post('/api/users').send({ email, password: PASSWORD });

  const notifications = () =>
    dataSource.query<NotificationRow[]>(
      'SELECT * FROM notification.notifications ORDER BY id DESC',
    );

  const waitFor = async <T>(check: () => Promise<T>, predicate: (v: T) => boolean, ms = 8000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const value = await check();
      if (predicate(value)) return value;
      if (Date.now() > deadline) return value;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    relay = app.get(OutboxRelay);
    consumers = app.get(DurableConsumerService);
    deadLetters = app.get(DeadLetterRepository);
    nats = app.get(NatsClient);
  });

  beforeEach(async () => {
    // The stream is external state that outlives the process, and the consumer
    // is DeliverPolicy.All. Without this, truncating processed_events makes
    // every message from every previous run eligible for replay.
    await nats.manager().streams.purge(STREAM_NAME);
    await dataSource.query('TRUNCATE identity.users RESTART IDENTITY');
    await dataSource.query('TRUNCATE outbox.events RESTART IDENTITY');
    await dataSource.query('TRUNCATE notification.notifications RESTART IDENTITY');
    await dataSource.query('TRUNCATE messaging.processed_events');
    await dataSource.query('TRUNCATE messaging.dead_letters RESTART IDENTITY');
  });

  afterAll(async () => {
    await app.close();
  });

  it('discovers the handler declared inside the notification context', () => {
    const found = consumers.handlers().map((h) => h.consumerName);

    expect(found).toContain('notification_welcome');
  });

  it('carries an event across contexts: register -> outbox -> NATS -> notification', async () => {
    await register('ada@example.com').expect(201);
    await relay.tick();

    const rows = await waitFor(notifications, (r) => r.length > 0);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBe('Welcome');
    expect(rows[0]?.body).toContain('ada@example.com');
  });

  it('records the idempotency marker under the consumer that handled it', async () => {
    await register('ada@example.com').expect(201);
    await relay.tick();
    await waitFor(notifications, (r) => r.length > 0);

    const marks = await dataSource.query<{ consumer_name: string }[]>(
      'SELECT consumer_name FROM messaging.processed_events',
    );

    expect(marks).toHaveLength(1);
    expect(marks[0]?.consumer_name).toBe('notification_welcome');
  });

  it('does not act twice when the same event is redelivered', async () => {
    await register('ada@example.com').expect(201);
    await relay.tick();
    await waitFor(notifications, (r) => r.length > 0);

    // Republishing the identical row is exactly what an at-least-once relay
    // does after a crash between publish and mark.
    await dataSource.query('UPDATE outbox.events SET published_at = NULL, attempts = 0');
    await relay.tick();

    await new Promise((r) => setTimeout(r, 1500));

    expect(await notifications()).toHaveLength(1);
  });

  it('two registrations produce two notifications', async () => {
    await register('ada@example.com').expect(201);
    await register('grace@example.com').expect(201);
    await relay.tick();

    const rows = await waitFor(notifications, (r) => r.length >= 2);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.body).join(' ')).toContain('grace@example.com');
  });

  it('dead-letters a message the handler cannot process, without blocking the stream', async () => {
    const handler = consumers.handlers().find((h) => h.consumerName === 'notification_welcome')!;
    const repository = app.get(NotificationRepository);
    const maxDeliver = app.get(AppConfig).durableConsumer.maxDeliver;

    const failure = jest
      .spyOn(repository, 'save')
      .mockRejectedValue(new Error('notification store unavailable'));

    try {
      await register('ada@example.com').expect(201);
      await relay.tick();

      const dead = await waitFor(
        () => deadLetters.count(),
        (n) => n > 0,
        (maxDeliver + 2) * 2500,
      );

      expect(dead).toBe(1);
      const [row] = await deadLetters.list();
      expect(row?.consumer_name).toBe('notification_welcome');
      expect(row?.error).toContain('notification store unavailable');
      expect(row?.delivery_count).toBeGreaterThanOrEqual(maxDeliver);
      expect(await notifications()).toHaveLength(0);
    } finally {
      failure.mockRestore();
      await deadLetters.discard(
        handler.consumerName,
        (await deadLetters.list())[0]?.idempotency_key ?? '00000000-0000-0000-0000-000000000000',
      );
    }

    // The consumer is still alive: a fresh event is handled normally.
    await register('grace@example.com').expect(201);
    await relay.tick();

    const rows = await waitFor(notifications, (r) => r.length > 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toContain('grace@example.com');
  }, 30000);
});
