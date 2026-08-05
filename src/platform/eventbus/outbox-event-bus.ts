import { Injectable } from '@nestjs/common';

import { EventBus } from '../../shared/application';
import { DomainEvent } from '../../shared/domain';
import { TransactionContext } from '../database/transaction-context';
import { InProcessEventBus } from './in-process-event-bus';

/**
 * The only EventBus a use case sees. It removes the durability decision from
 * the call site entirely:
 *
 * - inside a transaction, the event is buffered and written to the outbox as
 *   part of that same transaction, then dispatched in-process after it commits;
 * - outside one, it is dispatched in-process immediately.
 *
 * fast-kit exposes `publish` and `publish_durable` and makes every call site
 * choose. That choice is a footgun: picking wrong silently drops an event
 * everyone assumes is durable, and the mistake is invisible until a downstream
 * projection is missing rows. Here it cannot be made wrong.
 */
@Injectable()
export class OutboxEventBus extends EventBus {
  constructor(
    private readonly context: TransactionContext,
    private readonly inProcess: InProcessEventBus,
  ) {
    super();
  }

  publish(event: DomainEvent): Promise<void> {
    return this.publishAll([event]);
  }

  async publishAll(events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const scope = this.context.current();

    if (scope) {
      scope.events.push(...events);
      return;
    }

    await this.inProcess.publishAll(events);
  }
}
