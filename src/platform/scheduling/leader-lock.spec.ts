import { RedisClient } from '../cache/redis.client';
import { LeaderLock } from './leader-lock';

/** Just enough Redis to show the SET NX and the compare-and-delete are correct. */
class FakeRedis {
  private readonly store = new Map<string, string>();
  failing = false;

  lastSet?: { px: string; ttlMs: number; nx: string };

  set(key: string, value: string, px: 'PX', ttlMs: number, nx: 'NX'): Promise<'OK' | null> {
    this.lastSet = { px, ttlMs, nx };
    if (this.failing) {
      return Promise.reject(new Error('ECONNREFUSED'));
    }
    if (this.store.has(key)) {
      return Promise.resolve(null);
    }
    this.store.set(key, value);
    return Promise.resolve('OK');
  }

  eval(_script: string, _keys: number, key: string, holder: string): Promise<number> {
    if (this.failing) {
      return Promise.reject(new Error('ECONNREFUSED'));
    }
    if (this.store.get(key) === holder) {
      this.store.delete(key);
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

describe('LeaderLock', () => {
  let redis: FakeRedis;
  let lock: LeaderLock;

  beforeEach(() => {
    redis = new FakeRedis();
    lock = new LeaderLock({ connection: redis } as unknown as RedisClient);
  });

  it('grants the lock to the first caller only', async () => {
    await expect(lock.acquire('nightly', 'replica-a', 1000)).resolves.toBe(true);
    await expect(lock.acquire('nightly', 'replica-b', 1000)).resolves.toBe(false);
  });

  it('acquires atomically with SET NX PX rather than a read followed by a write', async () => {
    await lock.acquire('nightly', 'replica-a', 1500);

    expect(redis.lastSet).toEqual({ px: 'PX', ttlMs: 1500, nx: 'NX' });
  });

  it('frees the lock for the next caller once released', async () => {
    await lock.acquire('nightly', 'replica-a', 1000);
    await lock.release('nightly', 'replica-a');

    await expect(lock.acquire('nightly', 'replica-b', 1000)).resolves.toBe(true);
  });

  it('will not let one holder release another holder’s lock', async () => {
    await lock.acquire('nightly', 'replica-a', 1000);

    // Replica B overran, its lock expired, A took over. B must not now delete A's.
    await lock.release('nightly', 'replica-b');

    expect(redis.has('scheduler:lock:nightly')).toBe(true);
    await expect(lock.acquire('nightly', 'replica-c', 1000)).resolves.toBe(false);
  });

  it('fails closed when Redis is unreachable, so nothing runs twice', async () => {
    redis.failing = true;

    await expect(lock.acquire('nightly', 'replica-a', 1000)).resolves.toBe(false);
  });

  it('swallows a failed release, leaving the TTL as the backstop', async () => {
    await lock.acquire('nightly', 'replica-a', 1000);
    redis.failing = true;

    await expect(lock.release('nightly', 'replica-a')).resolves.toBeUndefined();
  });
});
