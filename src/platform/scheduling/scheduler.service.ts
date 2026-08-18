import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { randomUUID } from 'node:crypto';

import { AppConfig } from '../config';
import { LeaderLock } from './leader-lock';
import { ScheduledTask } from './scheduled-task';

@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly inFlight = new Map<string, Promise<boolean>>();
  /** Identifies this process to the lock, so a release cannot free someone else's turn. */
  private readonly holder = randomUUID();
  private stopped = false;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly lock: LeaderLock,
    private readonly config: AppConfig,
  ) {}

  /** Every provider that extends ScheduledTask, wherever it is declared. */
  tasks(): ScheduledTask[] {
    return this.discovery
      .getProviders()
      .map((wrapper) => wrapper.instance as unknown)
      .filter((instance): instance is ScheduledTask => instance instanceof ScheduledTask);
  }

  onApplicationBootstrap(): void {
    if (!this.config.scheduler.enabled) {
      this.logger.warn('scheduler disabled; no timed work will run');
      return;
    }

    for (const task of this.tasks()) {
      const timer = setInterval(() => void this.tick(task), task.intervalMs);
      // A pending tick must not keep the process alive through a shutdown.
      timer.unref();
      this.timers.push(timer);
      this.logger.log(`scheduled '${task.name}' every ${task.intervalMs}ms`);
    }
  }

  /**
   * Stops the timers, then waits for whatever is already running.
   *
   * Returning immediately would leave a task mid-write against a connection
   * pool that is about to be destroyed — which is exactly how this was first
   * found, as a test suite that would not exit. It also still holds its lock
   * at that point, so the next replica could not pick the work up either.
   */
  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    await Promise.allSettled(this.inFlight.values());
  }

  /** Exposed so a test drives one run deterministically rather than waiting on a timer. */
  async tick(task: ScheduledTask): Promise<boolean> {
    // Two guards, for two different overlaps: `inFlight` stops this replica
    // starting a second copy while the first is slow, and the lock stops a
    // different replica starting one at all.
    if (this.stopped || this.inFlight.has(task.name)) {
      return false;
    }

    const ttlMs = this.config.scheduler.lockTtlMs;
    if (!(await this.lock.acquire(task.name, this.holder, ttlMs))) {
      return false;
    }

    // Registered before it is awaited, so a shutdown arriving mid-run has
    // something to wait on.
    const running = this.run(task);
    this.inFlight.set(task.name, running);

    try {
      return await running;
    } finally {
      this.inFlight.delete(task.name);
      await this.lock.release(task.name, this.holder);
    }
  }

  private async run(task: ScheduledTask): Promise<boolean> {
    try {
      await task.run();
      return true;
    } catch (error) {
      // A throwing task must not kill the interval — the next tick is the retry.
      this.logger.error(
        `task '${task.name}' failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
