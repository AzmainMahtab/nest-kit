import { DiscoveryService } from '@nestjs/core';

import { AppConfig } from '../config';
import { LeaderLock } from './leader-lock';
import { ScheduledTask } from './scheduled-task';
import { SchedulerService } from './scheduler.service';

class CountingTask extends ScheduledTask {
  readonly name = 'counting';
  readonly intervalMs = 1000;
  runs = 0;

  run(): Promise<void> {
    this.runs += 1;
    return Promise.resolve();
  }
}

describe('SchedulerService', () => {
  let task: CountingTask;
  let lock: { acquire: jest.Mock; release: jest.Mock };

  const config = (enabled = true): AppConfig =>
    ({ scheduler: { enabled, lockTtlMs: 60_000 } }) as AppConfig;

  const discoveryOf = (...instances: unknown[]): DiscoveryService =>
    ({ getProviders: () => instances.map((instance) => ({ instance })) }) as DiscoveryService;

  const serviceWith = (enabled = true): SchedulerService =>
    new SchedulerService(
      discoveryOf(task, { notATask: true }),
      lock as unknown as LeaderLock,
      config(enabled),
    );

  beforeEach(() => {
    task = new CountingTask();
    lock = {
      acquire: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('discovers only providers that extend ScheduledTask', () => {
    expect(serviceWith().tasks()).toEqual([task]);
  });

  it('runs the task and releases the lock afterwards', async () => {
    const service = serviceWith();

    await expect(service.tick(task)).resolves.toBe(true);

    expect(task.runs).toBe(1);
    expect(lock.acquire).toHaveBeenCalledWith('counting', expect.any(String), 60_000);
    expect(lock.release).toHaveBeenCalledWith('counting', expect.any(String));
  });

  it('acquires and releases under the same holder id', async () => {
    let acquiredBy: string | undefined;
    let releasedBy: string | undefined;
    lock.acquire.mockImplementation((_name: string, holder: string) => {
      acquiredBy = holder;
      return Promise.resolve(true);
    });
    lock.release.mockImplementation((_name: string, holder: string) => {
      releasedBy = holder;
      return Promise.resolve();
    });

    await serviceWith().tick(task);

    expect(acquiredBy).toBeDefined();
    expect(releasedBy).toBe(acquiredBy);
  });

  it('does not run when another replica holds the lock', async () => {
    lock.acquire.mockResolvedValue(false);
    const service = serviceWith();

    await expect(service.tick(task)).resolves.toBe(false);

    expect(task.runs).toBe(0);
    // Nothing was acquired, so nothing may be released — releasing here would
    // free the lock the other replica is currently working under.
    expect(lock.release).not.toHaveBeenCalled();
  });

  it('releases the lock even when the task throws, and survives to the next tick', async () => {
    const failing = new (class extends ScheduledTask {
      readonly name = 'failing';
      readonly intervalMs = 1000;
      run(): Promise<void> {
        return Promise.reject(new Error('boom'));
      }
    })();
    const service = serviceWith();

    await expect(service.tick(failing)).resolves.toBe(false);

    expect(lock.release).toHaveBeenCalledWith('failing', expect.any(String));
    await expect(service.tick(failing)).resolves.toBe(false);
  });

  it('does nothing at all when the scheduler is disabled', () => {
    const service = serviceWith(false);

    service.onApplicationBootstrap();

    expect(lock.acquire).not.toHaveBeenCalled();
  });

  it('refuses to start a tick after shutdown', async () => {
    const service = serviceWith();
    await service.onApplicationShutdown();

    await expect(service.tick(task)).resolves.toBe(false);
    expect(task.runs).toBe(0);
  });

  it('waits on work already in flight before shutting down', async () => {
    let finish = (): void => undefined;
    const slow = new (class extends ScheduledTask {
      readonly name = 'slow';
      readonly intervalMs = 1000;
      finished = false;
      run(): Promise<void> {
        return new Promise<void>((resolve) => {
          finish = () => {
            this.finished = true;
            resolve();
          };
        });
      }
    })();
    const service = serviceWith();

    const running = service.tick(slow);
    // Yield so the task is registered as in flight before shutdown arrives.
    await Promise.resolve();

    const shutdown = service.onApplicationShutdown();
    finish();
    await shutdown;
    await running;

    // Had shutdown returned early, this would be false and the task would
    // still be writing against a pool that is being torn down.
    expect(slow.finished).toBe(true);
  });
});
