import { INestApplication, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { RedisClient } from './../src/platform/cache/redis.client';
import { AppConfig } from './../src/platform/config';
import { configureApp } from './../src/platform/http/configure-app';

const PASSWORD = 'correct-horse-battery';

interface DependencyCheckBody {
  name: string;
  status: string;
  required: boolean;
  latencyMs: number;
}
interface ReadinessBody {
  status: string;
  checks: DependencyCheckBody[];
}
interface LivenessBody {
  status: string;
}
interface ErrorBody {
  success: false;
  error: { code: string };
  correlationId?: string;
}

const ok = <T>(res: { body: unknown }): T => (res.body as { data: T }).data;
const fail = (res: { body: unknown }): ErrorBody => res.body as ErrorBody;

describe('Operations (e2e — requires Postgres, Redis, NATS)', () => {
  let app: INestApplication<App>;
  let redis: RedisClient;

  const http = () => request(app.getHttpServer());

  /**
   * The limiter counts per client IP in Redis, and Redis outlives the process.
   * Without this, a suite's leftover counters decide whether the next run
   * passes — the same reason the messaging suites purge the stream.
   */
  const clearCounters = async (): Promise<void> => {
    const keys = await redis.connection.keys('ratelimit:*');
    if (keys.length > 0) {
      await redis.connection.del(...keys);
    }
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    redis = app.get(RedisClient);
  });

  beforeEach(clearCounters);

  // Closing drains the NATS connection and the pool; the default 5s hook
  // budget is not enough on a cold machine.
  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  }, 30000);

  describe('API versioning', () => {
    it('serves the API under the versioned prefix', async () => {
      const response = await http()
        .post('/api/v1/users')
        .send({ email: `v1-${Date.now()}@example.com`, password: PASSWORD });

      expect(response.status).toBe(201);
    });

    it('does not serve the unversioned path', async () => {
      // An unversioned path must 404 rather than quietly aliasing v1: two live
      // spellings of one route means clients pin neither, and v2 breaks them.
      await http()
        .post('/api/users')
        .send({ email: 'x@example.com', password: PASSWORD })
        .expect(404);
    });

    it('keeps probes and the scrape unversioned', async () => {
      await http().get('/health').expect(200);
      await http().get('/health/ready').expect(200);
      await http().get('/metrics').expect(200);
    });
  });

  describe('readiness', () => {
    it('reports every dependency, and which of them are required', async () => {
      const { status, checks } = ok<ReadinessBody>(await http().get('/health/ready').expect(200));

      expect(status).toBe('ready');
      expect(checks.map((c) => c.name).sort()).toEqual(['nats', 'postgres', 'redis']);

      const required = Object.fromEntries(checks.map((c) => [c.name, c.required]));

      // NATS being advisory is the whole point of the outbox: the API keeps
      // serving while the broker is away.
      expect(required).toEqual({ postgres: true, redis: true, nats: false });
    });

    it('is a different endpoint from liveness', async () => {
      // Liveness must not touch a dependency — wiring both probes to the same
      // check turns a Postgres blip into a cluster-wide restart loop.
      expect(ok<LivenessBody>(await http().get('/health').expect(200))).toEqual({ status: 'ok' });
    });
  });

  describe('metrics', () => {
    it('exposes the Prometheus exposition format, not the envelope', async () => {
      const response = await http().get('/metrics').expect(200);

      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.text).toContain('# HELP http_requests_total');
      expect(response.text).not.toContain('"success"');
    });

    it('counts requests by route pattern, never by URL', async () => {
      const uuid = '00000000-0000-0000-0000-000000000000';
      await http().get(`/api/v1/users/${uuid}`);

      const metrics = (await http().get('/metrics').expect(200)).text;

      // The pattern, so the series count stays bounded no matter how many
      // users are fetched.
      expect(metrics).toContain('route="/api/v1/users/:uuid"');
      expect(metrics).not.toContain(uuid);
    });

    it('publishes the outbox and consumer backlog for alerting', async () => {
      const metrics = (await http().get('/metrics').expect(200)).text;

      expect(metrics).toContain('outbox_pending_events');
      expect(metrics).toContain('outbox_oldest_pending_age_seconds');
      expect(metrics).toContain('messaging_broker_reachable');
      expect(metrics).toContain('consumer_pending_messages');
    });
  });

  describe('correlation id', () => {
    it('assigns one to every response', async () => {
      const response = await http().get('/health').expect(200);

      expect(response.headers['x-request-id']).toMatch(/^[\w.:-]+$/);
    });

    it('honours a well-formed id from the caller so a trace survives the hop', async () => {
      const response = await http().get('/health').set('x-request-id', 'trace-abc-123').expect(200);

      expect(response.headers['x-request-id']).toBe('trace-abc-123');
    });

    it('replaces one that could poison a log line', async () => {
      // A raw newline never gets this far — Node's HTTP client refuses to send
      // it. What a caller *can* send is quotes and spaces, which is enough to
      // forge a field in a JSON log line or fabricate a dashboard label.
      const forged = 'abc" ,"level":"info';
      const response = await http().get('/health').set('x-request-id', forged).expect(200);

      expect(response.headers['x-request-id']).not.toBe(forged);
      expect(response.headers['x-request-id']).toMatch(/^[\w.:-]+$/);
    });

    it('replaces one long enough to bloat every log line it appears in', async () => {
      const forged = 'a'.repeat(500);
      const response = await http().get('/health').set('x-request-id', forged).expect(200);

      expect(response.headers['x-request-id']).not.toBe(forged);
    });

    it('is on the request log line, so one query returns the whole request', async () => {
      const lines: string[] = [];
      const spy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation((m: unknown) => void lines.push(String(m)));

      await http().get('/api/v1/users').set('x-request-id', 'trace-e2e').expect(401);
      spy.mockRestore();

      // The line itself is emitted inside the middleware's async context, so
      // StructuredLogger stamps it with the id without the call site knowing.
      expect(lines.some((l) => l.includes('GET /api/v1/users 401'))).toBe(true);
    });

    it('puts it in the error body, where a user can read it off the screen', async () => {
      const response = await http().get('/api/v1/does-not-exist').expect(404);

      expect(fail(response).correlationId).toBe(response.headers['x-request-id']);
    });
  });

  describe('rate limiting', () => {
    const tighten = (limit: number, authLimit = limit) =>
      jest.spyOn(AppConfig.prototype, 'rateLimit', 'get').mockReturnValue({
        enabled: true,
        limit,
        windowSeconds: 60,
        authLimit,
        authWindowSeconds: 60,
      });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('rejects the request past the budget with the error envelope', async () => {
      tighten(3);

      for (let i = 0; i < 3; i++) {
        await http().get('/api/v1/users').expect(401);
      }

      const response = await http().get('/api/v1/users').expect(429);

      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'RATE_LIMITED' },
      });
      expect(response.headers['retry-after']).toBeDefined();
    });

    it('tells a well-behaved client how much budget is left', async () => {
      tighten(10);

      const response = await http().get('/api/v1/users').expect(401);

      expect(response.headers['x-ratelimit-limit']).toBe('10');
      expect(response.headers['x-ratelimit-remaining']).toBe('9');
      expect(Number(response.headers['x-ratelimit-reset'])).toBeGreaterThan(0);
    });

    it('runs before authentication, so an unauthenticated flood is cheap', async () => {
      tighten(2);

      await http().get('/api/v1/users').expect(401);
      await http().get('/api/v1/users').expect(401);

      // 429 rather than 401 proves the limiter guard ran first. If AuthModule
      // were imported before HttpModule this would be 401 forever and a
      // credential-less flood would cost a signature check every time.
      await http().get('/api/v1/users').expect(429);
    });

    it('gives credential endpoints their own tighter budget', async () => {
      tighten(100, 2);

      const login = () =>
        http().post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: PASSWORD });

      await login().expect(401);
      await login().expect(401);
      await login().expect(429);

      // The global budget is untouched: the buckets are separate, so a
      // password-guessing loop cannot lock the rest of the API out.
      await http().get('/api/v1/users').expect(401);
    });

    it('exempts the probes, which are supposed to be frequent', async () => {
      tighten(2);

      for (let i = 0; i < 5; i++) {
        await http().get('/health').expect(200);
      }
    });
  });
});
