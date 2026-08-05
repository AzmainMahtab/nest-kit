import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * Carries the active transactional EntityManager across the async call stack.
 *
 * This is what lets a repository stay unaware of transactions: it asks for the
 * current manager and gets either the transactional one or the default. Without
 * it, a repository calling `dataSource.query(...)` would take a *different*
 * connection from the pool and silently run outside the caller's transaction.
 */
@Injectable()
export class TransactionContext {
  private readonly storage = new AsyncLocalStorage<EntityManager>();

  current(): EntityManager | undefined {
    return this.storage.getStore();
  }

  run<T>(manager: EntityManager, work: () => Promise<T>): Promise<T> {
    return this.storage.run(manager, work);
  }
}
