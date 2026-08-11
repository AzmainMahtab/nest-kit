import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { RedisClient } from '../cache/redis.client';
import { AppConfig } from '../config';
import { NatsClient } from '../messaging/nats-client';

export type DependencyStatus = 'up' | 'down';
export type ReadinessStatus = 'ready' | 'degraded' | 'not_ready';

export interface DependencyCheck {
  name: string;
  status: DependencyStatus;
  /** False for a dependency the API can serve traffic without. */
  required: boolean;
  latencyMs: number;
  error?: string;
}

export interface ReadinessReport {
  status: ReadinessStatus;
  checks: DependencyCheck[];
}

/**
 * Answers "should this instance receive traffic?", which is a different
 * question from "is the process alive?".
 *
 * Not every dependency gets a vote:
 *
 * - **Postgres is required.** Nothing works without it.
 * - **Redis is required.** `JwtAuthGuard` consults the revocation list on
 *   every authenticated request and `isRevoked` throws when Redis is gone, so
 *   a Redis outage is a 500 on every protected route. It is not optional in
 *   practice, whatever the word "cache" suggests.
 * - **NATS is not.** The outbox exists precisely so the API keeps accepting
 *   writes while the broker is away; events queue and drain later. Failing
 *   readiness here would pull every replica out of the load balancer for an
 *   outage the design already absorbs — turning a delayed projection into a
 *   full outage. It is reported as `degraded` so it is still visible.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisClient,
    private readonly nats: NatsClient,
    private readonly config: AppConfig,
  ) {}

  async readiness(): Promise<ReadinessReport> {
    const checks = await Promise.all([
      this.check('postgres', true, () => this.dataSource.query('SELECT 1')),
      this.check('redis', true, () => this.redis.connection.ping()),
      this.check('nats', false, () => this.assertNats()),
    ]);

    return { status: this.summarise(checks), checks };
  }

  private summarise(checks: DependencyCheck[]): ReadinessStatus {
    if (checks.some((c) => c.required && c.status === 'down')) {
      return 'not_ready';
    }

    return checks.some((c) => c.status === 'down') ? 'degraded' : 'ready';
  }

  private async check(
    name: string,
    required: boolean,
    probe: () => Promise<unknown>,
  ): Promise<DependencyCheck> {
    const started = Date.now();

    try {
      await this.withTimeout(probe(), name);
      return { name, required, status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      return {
        name,
        required,
        status: 'down',
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * A hung socket is the common failure, not a refused one, and a probe that
   * hangs is worse than a probe that fails: the orchestrator waits on it while
   * the instance keeps taking traffic it cannot serve.
   */
  private async withTimeout<T>(work: Promise<T>, name: string): Promise<T> {
    const timeoutMs = this.config.health.timeoutMs;
    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${name} timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      // Without this the process holds an open handle per probe and a
      // one-shot command never exits.
      if (timer) clearTimeout(timer);
    }
  }

  private assertNats(): Promise<void> {
    return this.nats.isReady()
      ? Promise.resolve()
      : Promise.reject(new Error('broker unreachable; events are queuing in the outbox'));
  }
}
