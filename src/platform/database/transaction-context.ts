import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { DomainEvent } from '../../shared/domain';

/**
 * Everything scoped to one transaction: the manager repositories must use, and
 * the events raised while it was open.
 */
export interface TransactionScope {
  readonly manager: EntityManager;
  readonly events: DomainEvent[];
}

/**
 * Carries the active transaction across the async call stack.
 *
 * This is what lets a repository stay unaware of transactions: it asks for the
 * current manager and gets either the transactional one or the default. Without
 * it, a repository calling `dataSource.query(...)` would take a *different*
 * connection from the pool and silently run outside the caller's transaction.
 *
 * The event buffer rides along so `EventBus.publish` can route an event into
 * the outbox atomically, without the use case having to know a transaction is
 * open (AGENTS.md §7).
 */
@Injectable()
export class TransactionContext {
  private readonly storage = new AsyncLocalStorage<TransactionScope>();

  current(): TransactionScope | undefined {
    return this.storage.getStore();
  }

  currentManager(): EntityManager | undefined {
    return this.storage.getStore()?.manager;
  }

  run<T>(scope: TransactionScope, work: () => Promise<T>): Promise<T> {
    return this.storage.run(scope, work);
  }
}
