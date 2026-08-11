import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';

import { AppError } from '../../../shared/errors';
import { RedisClient } from '../../cache/redis.client';
import { AppConfig } from '../../config';
import { MetricsService } from '../../observability/metrics.service';
import {
  RATE_LIMIT_KEY,
  RateLimitBudget,
  RateLimitSetting,
} from '../decorators/rate-limit.decorator';

/**
 * INCR, then EXPIRE only on the request that created the key, then read the
 * TTL — in one round trip so the three cannot interleave with another
 * replica's.
 *
 * Doing it in three commands from Node has a real failure mode: two requests
 * both see a count of 1 and both set the expiry, sliding the window forward
 * forever under sustained load. It also loses the key's TTL, which is what
 * `Retry-After` needs.
 */
const FIXED_WINDOW = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return { current, redis.call('TTL', KEYS[1]) }
`;

/**
 * A fixed window per client, shared across replicas through Redis.
 *
 * Registered as the *first* global guard, ahead of `JwtAuthGuard`, so an
 * unauthenticated flood is rejected before it costs a signature verification
 * and a Redis blacklist lookup — and so that login, which by definition has no
 * token yet, is covered at all.
 *
 * In-memory counting was the alternative and is not one: with two replicas
 * behind a balancer, a limit of 10 is a limit of 20, and it resets on every
 * deploy.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisClient,
    private readonly config: AppConfig,
    private readonly metrics: MetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.rateLimit.enabled || context.getType() !== 'http') {
      return true;
    }

    const setting =
      this.reflector.getAllAndOverride<RateLimitSetting>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'default';

    if (setting === 'none') {
      return true;
    }

    const budget = this.budgetFor(setting);
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const key = `ratelimit:${budget.scope}:${this.clientId(request)}`;

    const hit = await this.count(key, budget.windowSeconds);

    if (!hit) {
      // Redis is down. Failing open is the deliberate choice: a limiter
      // outage must not become an outage. The blast radius of the opposite
      // is every request in the system, for a control that is a safeguard
      // rather than an authorization decision.
      return true;
    }

    const remaining = Math.max(0, budget.limit - hit.count);

    response.setHeader('x-ratelimit-limit', budget.limit);
    response.setHeader('x-ratelimit-remaining', remaining);
    response.setHeader('x-ratelimit-reset', hit.resetSeconds);

    if (hit.count > budget.limit) {
      this.metrics.rateLimited(budget.scope);
      response.setHeader('retry-after', hit.resetSeconds);

      throw AppError.rateLimited(
        'RATE_LIMITED',
        `too many requests; retry in ${hit.resetSeconds}s`,
      );
    }

    return true;
  }

  private budgetFor(setting: Exclude<RateLimitSetting, 'none'>): RateLimitBudget {
    if (typeof setting !== 'string') {
      return setting;
    }

    const { limit, windowSeconds, authLimit, authWindowSeconds } = this.config.rateLimit;

    return setting === 'auth'
      ? { scope: 'auth', limit: authLimit, windowSeconds: authWindowSeconds }
      : { scope: 'global', limit, windowSeconds };
  }

  private async count(
    key: string,
    windowSeconds: number,
  ): Promise<{ count: number; resetSeconds: number } | null> {
    try {
      const [count, ttl] = (await this.redis.connection.eval(
        FIXED_WINDOW,
        1,
        key,
        String(windowSeconds),
      )) as [number, number];

      // TTL is -1 for a key that somehow lost its expiry; treat the window as
      // full rather than reporting a negative reset.
      return { count, resetSeconds: ttl > 0 ? ttl : windowSeconds };
    } catch (error) {
      this.logger.warn(
        `rate limit unavailable, allowing request: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * The socket address, unless something in front of us is known to rewrite
   * it. `X-Forwarded-For` is caller-supplied: trusting it unconditionally
   * hands every client an unlimited supply of fresh budgets.
   */
  private clientId(request: Request): string {
    if (this.config.trustProxy) {
      const forwarded = request.headers['x-forwarded-for'];
      const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      const first = value?.split(',')[0]?.trim();

      if (first) {
        return first;
      }
    }

    return request.ip ?? request.socket.remoteAddress ?? 'unknown';
  }
}
