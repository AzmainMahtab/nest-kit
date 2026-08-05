import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { TransactionContext, TransactionalRepository } from './../src/platform/database';
import { UnitOfWork } from './../src/shared/application';

class ProbeRepository extends TransactionalRepository {
  insert(note: string): Promise<unknown> {
    return this.manager().query('INSERT INTO public.uow_probe (note) VALUES ($1)', [note]);
  }

  async countAll(): Promise<number> {
    const rows = await this.manager().query<{ count: string }[]>(
      'SELECT COUNT(*)::text AS count FROM public.uow_probe',
    );
    return Number(rows[0]?.count ?? 0);
  }
}

describe('Transactions (e2e — requires Postgres, `make db-up`)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let uow: UnitOfWork;
  let repo: ProbeRepository;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    uow = app.get(UnitOfWork);
    repo = new ProbeRepository(dataSource, app.get(TransactionContext));

    await dataSource.query(
      'CREATE TABLE IF NOT EXISTS public.uow_probe (id BIGSERIAL PRIMARY KEY, note TEXT NOT NULL)',
    );
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE public.uow_probe');
  });

  afterAll(async () => {
    await dataSource.query('DROP TABLE IF EXISTS public.uow_probe');
    await app.close();
  });

  it('commits when the block resolves', async () => {
    await uow.withTransaction(() => repo.insert('committed'));

    expect(await repo.countAll()).toBe(1);
  });

  it('rolls back every write when the block throws', async () => {
    await expect(
      uow.withTransaction(async () => {
        await repo.insert('first');
        await repo.insert('second');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await repo.countAll()).toBe(0);
  });

  it('rolls back the outer writes too when an inner block throws', async () => {
    await expect(
      uow.withTransaction(async () => {
        await repo.insert('outer');
        await uow.withTransaction(() => repo.insert('inner'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await repo.countAll()).toBe(0);
  });

  it('reads its own uncommitted writes through the transactional manager', async () => {
    await uow.withTransaction(async () => {
      await repo.insert('pending');
      expect(await repo.countAll()).toBe(1);
    });
  });

  it('does not see uncommitted writes from a connection outside the transaction', async () => {
    await uow.withTransaction(async () => {
      await repo.insert('pending');

      // The bug TransactionalRepository exists to prevent: going through the
      // DataSource checks out a different pooled connection, so the write is
      // invisible and would not roll back with the block either.
      const rows = await dataSource.query<{ count: string }[]>(
        'SELECT COUNT(*)::text AS count FROM public.uow_probe',
      );
      expect(Number(rows[0]?.count)).toBe(0);
    });

    expect(await repo.countAll()).toBe(1);
  });
});
