import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { UnitOfWork } from '../../shared/application';
import { DomainEvent } from '../../shared/domain';
import { InProcessEventBus } from '../eventbus/in-process-event-bus';
import { OutboxRepository } from '../outbox/outbox.repository';
import { TransactionContext } from './transaction-context';

@Injectable()
export class TypeOrmUnitOfWork extends UnitOfWork {
  constructor(
    private readonly dataSource: DataSource,
    private readonly context: TransactionContext,
    private readonly outbox: OutboxRepository,
    private readonly inProcess: InProcessEventBus,
  ) {
    super();
  }

  /**
   * A nested call joins the transaction already in progress rather than opening
   * a savepoint. Savepoints read as isolation but are not: the inner block can
   * "roll back" and still be committed by the outer one, which is a worse
   * failure than having no nesting at all. One `withTransaction` per use case,
   * and an inner one is a no-op wrapper — including for the outbox flush, which
   * only the outermost call performs.
   */
  async withTransaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.context.current()) {
      return work();
    }

    const events: DomainEvent[] = [];

    const result = await this.dataSource.transaction(async (manager) => {
      const value = await this.context.run({ manager, events }, work);

      // Written last, on the caller's manager, so the events commit or roll
      // back with the data that produced them.
      await this.outbox.append(events, manager);

      return value;
    });

    // Only after the commit. In-process handlers are not part of the
    // transaction, and a handler failure must not undo a committed write —
    // the outbox row is what guarantees the event is not lost.
    await this.inProcess.publishAll(events);

    return result;
  }
}
