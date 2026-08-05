import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { UnitOfWork } from '../../shared/application';
import { TransactionContext } from './transaction-context';

@Injectable()
export class TypeOrmUnitOfWork extends UnitOfWork {
  constructor(
    private readonly dataSource: DataSource,
    private readonly context: TransactionContext,
  ) {
    super();
  }

  /**
   * A nested call joins the transaction already in progress rather than opening
   * a savepoint. Savepoints read as isolation but are not: the inner block can
   * "roll back" and still be committed by the outer one, which is a worse
   * failure than having no nesting at all. One `withTransaction` per use case,
   * and an inner one is a no-op wrapper.
   */
  async withTransaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.context.current()) {
      return work();
    }

    return this.dataSource.transaction((manager) => this.context.run(manager, work));
  }
}
