import { EntityManager } from 'typeorm';

import { DomainEvent } from '../../shared/domain';
import { TransactionContext } from '../database/transaction-context';
import { InProcessEventBus } from './in-process-event-bus';
import { OutboxEventBus } from './outbox-event-bus';

class TestEvent extends DomainEvent {
  readonly name = 'test.thing.happened';
}

function build() {
  const dispatched: DomainEvent[] = [];
  const inProcess = {
    publishAll: (events: readonly DomainEvent[]) => {
      dispatched.push(...events);
      return Promise.resolve();
    },
  } as unknown as InProcessEventBus;

  const context = new TransactionContext();

  return { context, dispatched, bus: new OutboxEventBus(context, inProcess) };
}

describe('OutboxEventBus', () => {
  it('dispatches immediately when no transaction is open', async () => {
    const { bus, dispatched } = build();

    await bus.publish(new TestEvent());

    expect(dispatched).toHaveLength(1);
  });

  it('buffers into the transaction scope instead of dispatching', async () => {
    const { bus, context, dispatched } = build();
    const events: DomainEvent[] = [];

    await context.run({ manager: {} as EntityManager, events }, async () => {
      await bus.publish(new TestEvent());
    });

    // The UnitOfWork writes these to the outbox inside the transaction and
    // dispatches them after it commits.
    expect(events).toHaveLength(1);
    expect(dispatched).toHaveLength(0);
  });

  it('is a no-op for an empty batch', async () => {
    const { bus, dispatched } = build();

    await bus.publishAll([]);

    expect(dispatched).toHaveLength(0);
  });
});
