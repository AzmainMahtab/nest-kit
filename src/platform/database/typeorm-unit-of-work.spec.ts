import { DataSource, EntityManager } from 'typeorm';

import { TransactionContext } from './transaction-context';
import { TypeOrmUnitOfWork } from './typeorm-unit-of-work';

function fakeDataSource(): { dataSource: DataSource; beginCount: () => number } {
  let begins = 0;
  const manager = { marker: 'transactional' } as unknown as EntityManager;

  const dataSource = {
    manager: { marker: 'default' } as unknown as EntityManager,
    transaction: async <T>(work: (m: EntityManager) => Promise<T>): Promise<T> => {
      begins += 1;
      return work(manager);
    },
  } as unknown as DataSource;

  return { dataSource, beginCount: () => begins };
}

describe('TypeOrmUnitOfWork', () => {
  it('exposes the transactional manager to code running inside the block', async () => {
    const { dataSource } = fakeDataSource();
    const context = new TransactionContext();
    const uow = new TypeOrmUnitOfWork(dataSource, context);

    expect(context.current()).toBeUndefined();

    await uow.withTransaction(() => {
      expect(context.current()).toEqual({ marker: 'transactional' });
      return Promise.resolve();
    });

    expect(context.current()).toBeUndefined();
  });

  it('joins an open transaction instead of opening a second one', async () => {
    const { dataSource, beginCount } = fakeDataSource();
    const context = new TransactionContext();
    const uow = new TypeOrmUnitOfWork(dataSource, context);

    await uow.withTransaction(async () => {
      await uow.withTransaction(async () => {
        await uow.withTransaction(() => Promise.resolve());
      });
    });

    expect(beginCount()).toBe(1);
  });

  it('propagates the result and clears the context when work throws', async () => {
    const { dataSource } = fakeDataSource();
    const context = new TransactionContext();
    const uow = new TypeOrmUnitOfWork(dataSource, context);

    await expect(uow.withTransaction(() => Promise.resolve('ok'))).resolves.toBe('ok');

    await expect(uow.withTransaction(() => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );

    expect(context.current()).toBeUndefined();
  });
});
