import { Injectable, Logger } from '@nestjs/common';

import { RedisClient } from '../cache/redis.client';

/**
 * Compare-and-delete. Releasing without checking the holder is the classic
 * distributed-lock defect: replica A's task overruns the TTL, the lock expires,
 * replica B acquires it, and A finishes and deletes B's lock — after which both
 * run, which is precisely what the lock existed to prevent.
 */
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

@Injectable()
export class LeaderLock {
  private readonly logger = new Logger(LeaderLock.name);

  constructor(private readonly redis: RedisClient) {}

  /**
   * Fails **closed**: if Redis cannot be reached the caller does not run.
   *
   * The opposite of the rate limiter, deliberately. A limiter that fails open
   * degrades to "no limit", which is a safeguard lost; a lock that fails open
   * degrades to "every replica runs the nightly billing job", which is damage
   * done. A skipped tick is recovered by the next one.
   */
  async acquire(name: string, holder: string, ttlMs: number): Promise<boolean> {
    try {
      const result = await this.redis.connection.set(this.key(name), holder, 'PX', ttlMs, 'NX');
      return result === 'OK';
    } catch (error) {
      this.logger.warn(
        `lock '${name}' unavailable, skipping this tick: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async release(name: string, holder: string): Promise<void> {
    try {
      await this.redis.connection.eval(RELEASE, 1, this.key(name), holder);
    } catch (error) {
      // The TTL is the backstop. A failed release delays the next run by at
      // most one lock lifetime, which is why the TTL must never be generous.
      this.logger.warn(
        `could not release lock '${name}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private key(name: string): string {
    return `scheduler:lock:${name}`;
  }
}
