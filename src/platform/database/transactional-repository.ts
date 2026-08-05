import { DataSource, EntityManager } from 'typeorm';

import { TransactionContext } from './transaction-context';

/**
 * Base for every persistence adapter. Subclasses must go through `manager()`
 * for all access — ORM calls and raw SQL alike — so they participate in an
 * open transaction automatically.
 *
 * Reaching for the injected DataSource directly is the bug this exists to
 * prevent: `dataSource.query(...)` checks out its own connection, so it neither
 * sees uncommitted writes nor rolls back with them.
 */
export abstract class TransactionalRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly context: TransactionContext,
  ) {}

  protected manager(): EntityManager {
    return this.context.current() ?? this.dataSource.manager;
  }
}
