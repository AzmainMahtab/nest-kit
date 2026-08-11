import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AckPolicy, DeliverPolicy, jetstream, jetstreamManager } from '@nats-io/jetstream';
import { NatsConnection, connect } from '@nats-io/transport-node';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/platform/http/configure-app';
import { AppConfig } from './../src/platform/config';
import { STREAM_NAME, SUBJECT_PREFIX } from './../src/platform/messaging';
import { OutboxRelay, OutboxRepository } from './../src/platform/outbox';

const PASSWORD = 'correct-horse-battery';

interface EventRow {
  id: string;
  name: string;
  payload: { userUuid: string; email: string };
  published_at: Date | null;
  dead_lettered_at: Date | null;
  attempts: number;
}

interface Message {
  name: string;
  idempotencyKey: string;
  payload: { email: string };
}

describe('Outbox + NATS (e2e — requires Postgres, NATS and `make migrate-up`)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let relay: OutboxRelay;
  let outbox: OutboxRepository;
  let nats: NatsConnection;

  const register = (email: string) =>
    request(app.getHttpServer()).post('/api/v1/users').send({ email, password: PASSWORD });

  const rows = () => dataSource.query<EventRow[]>('SELECT * FROM outbox.events ORDER BY id');

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    relay = app.get(OutboxRelay);
    outbox = app.get(OutboxRepository);
    nats = await connect({ servers: app.get(AppConfig).nats.url });
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE identity.users RESTART IDENTITY');
    await dataSource.query('TRUNCATE outbox.events RESTART IDENTITY');
  });

  afterAll(async () => {
    await nats.close();
    await app.close();
  });

  it('writes the event to the outbox in the same transaction as the user', async () => {
    await register('ada@example.com').expect(201);

    const [row] = await rows();
    expect(row?.name).toBe('identity.user.registered');
    expect(row?.payload.email).toBe('ada@example.com');
    expect(row?.published_at).toBeNull();

    const users = await dataSource.query<{ count: string }[]>(
      'SELECT COUNT(*)::text AS count FROM identity.users',
    );
    expect(Number(users[0]?.count)).toBe(1);
  });

  it('writes no event when the write fails', async () => {
    await register('ada@example.com').expect(201);
    await dataSource.query('TRUNCATE outbox.events RESTART IDENTITY');

    // Rejected by the duplicate check inside the transaction.
    await register('ada@example.com').expect(409);

    expect(await rows()).toHaveLength(0);
  });

  it('relays to JetStream and marks the row published', async () => {
    await register('ada@example.com').expect(201);

    expect(await outbox.countPending()).toBe(1);
    const drained = await relay.tick();
    expect(drained).toBe(1);

    const [row] = await rows();
    expect(row?.published_at).not.toBeNull();
    expect(await outbox.countPending()).toBe(0);
  });

  it('delivers a message a consumer can read and dedup on', async () => {
    await register('grace@example.com').expect(201);

    const manager = await jetstreamManager(nats);
    const consumerName = `test_${Date.now()}`;
    await manager.consumers.add(STREAM_NAME, {
      durable_name: consumerName,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      filter_subject: `${SUBJECT_PREFIX}.identity.user.registered`,
    });

    await relay.tick();

    const consumer = await jetstream(nats).consumers.get(STREAM_NAME, consumerName);
    const batch = await consumer.fetch({ max_messages: 1, expires: 5000 });

    const received: Message[] = [];
    for await (const message of batch) {
      received.push(JSON.parse(new TextDecoder().decode(message.data)) as Message);
      message.ack();
    }

    await manager.consumers.delete(STREAM_NAME, consumerName);

    expect(received).toHaveLength(1);
    expect(received[0]?.name).toBe('identity.user.registered');
    expect(received[0]?.payload.email).toBe('grace@example.com');
    expect(received[0]?.idempotencyKey).toHaveLength(36);
  });

  it('is idempotent across repeated drains', async () => {
    await register('ada@example.com').expect(201);

    expect(await relay.tick()).toBe(1);
    expect(await relay.tick()).toBe(0);
    expect(await relay.tick()).toBe(0);

    expect(await rows()).toHaveLength(1);
  });

  it('dead-letters a row once attempts are exhausted, and replay revives it', async () => {
    await register('ada@example.com').expect(201);
    const [row] = await rows();
    const id = row!.id;

    const maxAttempts = app.get(AppConfig).outbox.maxAttempts;
    await dataSource.query('UPDATE outbox.events SET attempts = $2 WHERE id = $1', [
      id,
      maxAttempts,
    ]);
    await outbox.recordFailure(id, 'simulated transport failure', maxAttempts);

    const [dead] = await rows();
    expect(dead?.dead_lettered_at).not.toBeNull();

    // Exhausted rows are skipped, not retried forever.
    expect(await relay.tick()).toBe(0);
    expect(await outbox.countPending()).toBe(0);

    expect(await outbox.replayDeadLettered([id])).toBe(1);
    const [revived] = await rows();
    expect(revived?.dead_lettered_at).toBeNull();
    expect(revived?.attempts).toBe(0);

    expect(await relay.tick()).toBe(1);
  });
});
