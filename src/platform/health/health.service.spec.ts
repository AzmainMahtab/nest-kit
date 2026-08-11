import { DataSource } from 'typeorm';

import { RedisClient } from '../cache/redis.client';
import { AppConfig } from '../config';
import { NatsClient } from '../messaging/nats-client';
import { HealthService } from './health.service';

function service(options: {
  postgres?: () => Promise<unknown>;
  redis?: () => Promise<unknown>;
  natsReady?: boolean;
  timeoutMs?: number;
}): HealthService {
  const dataSource = {
    query: options.postgres ?? (() => Promise.resolve([{ '?column?': 1 }])),
  } as unknown as DataSource;

  const redis = {
    connection: { ping: options.redis ?? (() => Promise.resolve('PONG')) },
  } as unknown as RedisClient;

  const nats = { isReady: () => options.natsReady ?? true } as unknown as NatsClient;
  const config = { health: { timeoutMs: options.timeoutMs ?? 2000 } } as unknown as AppConfig;

  return new HealthService(dataSource, redis, nats, config);
}

describe('HealthService', () => {
  it('is ready when everything answers', async () => {
    const report = await service({}).readiness();

    expect(report.status).toBe('ready');
    expect(report.checks.every((c) => c.status === 'up')).toBe(true);
  });

  it('is only degraded when the broker is away', async () => {
    const report = await service({ natsReady: false }).readiness();

    // The outbox absorbs a broker outage — events queue and drain later.
    // Failing readiness here would pull every replica out of the load
    // balancer for a fault the design already handles.
    expect(report.status).toBe('degraded');
    expect(report.checks.find((c) => c.name === 'nats')).toMatchObject({
      status: 'down',
      required: false,
    });
  });

  it('is not ready without Postgres', async () => {
    const report = await service({
      postgres: () => Promise.reject(new Error('ECONNREFUSED')),
    }).readiness();

    expect(report.status).toBe('not_ready');
    expect(report.checks.find((c) => c.name === 'postgres')?.error).toContain('ECONNREFUSED');
  });

  it('is not ready without Redis', async () => {
    // Not a nicety: JwtAuthGuard consults the revocation list on every
    // authenticated request, and that lookup throws when Redis is gone.
    const report = await service({ redis: () => Promise.reject(new Error('down')) }).readiness();

    expect(report.status).toBe('not_ready');
  });

  it('fails a probe that hangs instead of hanging with it', async () => {
    const report = await service({
      postgres: () => new Promise(() => undefined),
      timeoutMs: 20,
    }).readiness();

    expect(report.status).toBe('not_ready');
    expect(report.checks.find((c) => c.name === 'postgres')?.error).toContain('timed out');
  });

  it('reports each dependency separately, so the cause is in the response', async () => {
    const report = await service({ natsReady: false }).readiness();

    expect(report.checks.map((c) => c.name).sort()).toEqual(['nats', 'postgres', 'redis']);
    expect(report.checks.every((c) => typeof c.latencyMs === 'number')).toBe(true);
  });
});
