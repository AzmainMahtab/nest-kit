import { DataSource, EntityManager } from 'typeorm';

import { DomainEvent } from '../../shared/domain';
import { InProcessEventBus } from '../eventbus/in-process-event-bus';
import { OutboxRepository } from '../outbox/outbox.repository';
import { TransactionContext } from './transaction-context';
import { TypeOrmUnitOfWork } from './typeorm-unit-of-work';

class TestEvent extends DomainEvent {
  readonly name = 'test.thing.happened';
  constructor(readonly note: string) {
    super();
  }
}

function harness(options: { failCommit?: boolean } = {}) {
  let begins = 0;
  const manager = { marker: 'transactional' } as unknown as EntityManager;

  const dataSource = {
    manager: { marker: 'default' } as unknown as EntityManager,
    transaction: async <T>(work: (m: EntityManager) => Promise<T>): Promise<T> => {
      begins += 1;
      const value = await work(manager);
      if (options.failCommit) {
        throw new Error('commit failed');
      }
      return value;
    },
  } as unknown as DataSource;

  const appended: { events: DomainEvent[]; manager: EntityManager }[] = [];
  const outbox = {
    append: (events: readonly DomainEvent[], m: EntityManager) => {
      appended.push({ events: [...events], manager: m });
      return Promise.resolve();
    },
  } as unknown as OutboxRepository;

  const dispatched: DomainEvent[] = [];
  const inProcess = {
    publishAll: (events: readonly DomainEvent[]) => {
      dispatched.push(...events);
      return Promise.resolve();
    },
  } as unknown as InProcessEventBus;

  const context = new TransactionContext();

  return {
    context,
    uow: new TypeOrmUnitOfWork(dataSource, context, outbox, inProcess),
    appended,
    dispatched,
    beginCount: () => begins,
  };
}

describe('TypeOrmUnitOfWork', () => {
  it('exposes the transactional manager to code running inside the block', async () => {
    const { uow, context } = harness();

    expect(context.currentManager()).toBeUndefined();

    await uow.withTransaction(() => {
      expect(context.currentManager()).toEqual({ marker: 'transactional' });
      return Promise.resolve();
    });

    expect(context.currentManager()).toBeUndefined();
  });

  it('joins an open transaction instead of opening a second one', async () => {
    const { uow, beginCount } = harness();

    await uow.withTransaction(async () => {
      await uow.withTransaction(async () => {
        await uow.withTransaction(() => Promise.resolve());
      });
    });

    expect(beginCount()).toBe(1);
  });

  it('writes buffered events to the outbox on the transactional manager', async () => {
    const { uow, context, appended } = harness();

    await uow.withTransaction(() => {
      context.current()?.events.push(new TestEvent('one'));
      return Promise.resolve();
    });

    expect(appended).toHaveLength(1);
    expect(appended[0]?.manager).toEqual({ marker: 'transactional' });
    expect(appended[0]?.events).toHaveLength(1);
  });

  it('flushes once for a nested block, not once per level', async () => {
    const { uow, context, appended } = harness();

    await uow.withTransaction(async () => {
      context.current()?.events.push(new TestEvent('outer'));
      await uow.withTransaction(() => {
        context.current()?.events.push(new TestEvent('inner'));
        return Promise.resolve();
      });
    });

    expect(appended).toHaveLength(1);
    expect(appended[0]?.events).toHaveLength(2);
  });

  it('dispatches in-process only after the transaction resolves', async () => {
    const { uow, context, dispatched } = harness();

    await uow.withTransaction(() => {
      context.current()?.events.push(new TestEvent('one'));
      expect(dispatched).toHaveLength(0);
      return Promise.resolve();
    });

    expect(dispatched).toHaveLength(1);
  });

  it('dispatches nothing when the transaction fails', async () => {
    const { uow, context, dispatched } = harness({ failCommit: true });

    await expect(
      uow.withTransaction(() => {
        context.current()?.events.push(new TestEvent('one'));
        return Promise.resolve();
      }),
    ).rejects.toThrow('commit failed');

    expect(dispatched).toHaveLength(0);
  });

  it('propagates the result and clears the context when work throws', async () => {
    const { uow, context } = harness();

    await expect(uow.withTransaction(() => Promise.resolve('ok'))).resolves.toBe('ok');
    await expect(uow.withTransaction(() => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );

    expect(context.current()).toBeUndefined();
  });
});
