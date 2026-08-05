import { Injectable } from '@nestjs/common';
import { EventBus as CqrsEventBus } from '@nestjs/cqrs';

import { EventBus } from '../../shared/application';
import { DomainEvent } from '../../shared/domain';

/**
 * In-process adapter for the `EventBus` port. Delivery is best effort: handlers
 * run in the same process and a handler failure does not roll back the caller.
 *
 * Swap this provider for a NATS `ClientProxy` adapter to extract a context —
 * no use case changes. See AGENTS.md §13.
 */
@Injectable()
export class InProcessEventBus extends EventBus {
  constructor(private readonly bus: CqrsEventBus) {
    super();
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.bus.publish(event);
  }

  async publishAll(events: readonly DomainEvent[]): Promise<void> {
    await this.bus.publishAll([...events]);
  }
}
