import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppError } from '../../../shared/errors';
import { RedisClient } from '../../cache/redis.client';
import { AppConfig } from '../../config';
import { MetricsService } from '../../observability/metrics.service';
import { RateLimitSetting } from '../decorators/rate-limit.decorator';
import { RateLimitGuard } from './rate-limit.guard';

const BUDGET = {
  enabled: true,
  limit: 3,
  windowSeconds: 60,
  authLimit: 2,
  authWindowSeconds: 60,
};

interface Harness {
  guard: RateLimitGuard;
  context: ExecutionContext;
  headers: Record<string, unknown>;
  keys: string[];
  metrics: { rateLimited: jest.Mock };
}

function harness(options: {
  setting?: RateLimitSetting;
  counts?: Array<[number, number] | Error>;
  ip?: string;
  forwardedFor?: string;
  trustProxy?: boolean;
  enabled?: boolean;
}): Harness {
  const counts = options.counts ?? [];
  const keys: string[] = [];
  let call = 0;

  const redis = {
    connection: {
      eval: (_script: string, _numKeys: number, key: string) => {
        keys.push(key);
        const next = counts[call++] ?? [1, 60];
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
    },
  } as unknown as RedisClient;

  const config = {
    rateLimit: { ...BUDGET, enabled: options.enabled ?? true },
    trustProxy: options.trustProxy ?? false,
  } as unknown as AppConfig;

  const reflector = {
    getAllAndOverride: () => options.setting,
  } as unknown as Reflector;

  const metrics = { rateLimited: jest.fn() };
  const headers: Record<string, unknown> = {};

  const request = {
    ip: options.ip ?? '10.0.0.1',
    headers: options.forwardedFor ? { 'x-forwarded-for': options.forwardedFor } : {},
    socket: { remoteAddress: '10.0.0.1' },
  };

  const context = {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: (k: string, v: unknown) => (headers[k] = v) }),
    }),
  } as unknown as ExecutionContext;

  return {
    guard: new RateLimitGuard(reflector, redis, config, metrics as unknown as MetricsService),
    context,
    headers,
    keys,
    metrics,
  };
}

describe('RateLimitGuard', () => {
  it('allows a request inside the budget and reports what is left', async () => {
    const h = harness({ counts: [[1, 60]] });

    await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
    expect(h.headers['x-ratelimit-limit']).toBe(3);
    expect(h.headers['x-ratelimit-remaining']).toBe(2);
    expect(h.headers['x-ratelimit-reset']).toBe(60);
  });

  it('rejects the request past the budget with a 429 AppError', async () => {
    const h = harness({ counts: [[4, 42]] });

    await expect(h.guard.canActivate(h.context)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
    expect(h.headers['retry-after']).toBe(42);
    expect(h.metrics.rateLimited).toHaveBeenCalledWith('global');
  });

  it('counts credential endpoints in their own bucket', async () => {
    const h = harness({ setting: 'auth', counts: [[3, 60]] });

    // Over the auth budget of 2 while still under the global 3 — the two
    // budgets must not share a counter, or a login flood locks out the API.
    await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(AppError);
    expect(h.keys[0]).toContain('ratelimit:auth:');
    expect(h.metrics.rateLimited).toHaveBeenCalledWith('auth');
  });

  it('lets a route opt out entirely', async () => {
    const h = harness({ setting: 'none', counts: [[99, 60]] });

    await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
    expect(h.keys).toEqual([]);
  });

  it('accepts an inline budget for a route unlike the others', async () => {
    const h = harness({
      setting: { scope: 'export', limit: 1, windowSeconds: 3600 },
      counts: [[2, 3000]],
    });

    await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(AppError);
    expect(h.keys[0]).toContain('ratelimit:export:');
  });

  it('fails open when Redis is unreachable', async () => {
    const h = harness({ counts: [new Error('ECONNREFUSED')] });

    // A limiter outage must not become an outage. This is a safeguard, not an
    // authorization decision.
    await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
    expect(h.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('ignores X-Forwarded-For unless the proxy is trusted', async () => {
    const h = harness({ forwardedFor: '1.2.3.4', counts: [[1, 60]] });

    // Otherwise a client rotates the header and mints itself a fresh budget
    // per request.
    await h.guard.canActivate(h.context);
    expect(h.keys[0]).toBe('ratelimit:global:10.0.0.1');
  });

  it('uses the first forwarded hop when the proxy is trusted', async () => {
    const h = harness({
      forwardedFor: '1.2.3.4, 10.0.0.9',
      trustProxy: true,
      counts: [[1, 60]],
    });

    await h.guard.canActivate(h.context);
    expect(h.keys[0]).toBe('ratelimit:global:1.2.3.4');
  });

  it('does nothing at all when disabled', async () => {
    const h = harness({ enabled: false, counts: [[99, 60]] });

    await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
    expect(h.keys).toEqual([]);
  });
});
