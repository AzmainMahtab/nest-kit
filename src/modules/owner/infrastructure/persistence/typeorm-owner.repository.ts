import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { TransactionContext, TransactionalRepository } from '../../../../platform/database';
import { Page, PaginationParams } from '../../../../shared/pagination';
import { Owner } from '../../domain/owner';
import { OwnerRepository } from '../../domain/ports/owner-repository.port';
import { OwnerMapper } from './owner.mapper';
import { OwnerOrmEntity } from './owner.orm-entity';

@Injectable()
export class TypeOrmOwnerRepository extends TransactionalRepository implements OwnerRepository {
  constructor(dataSource: DataSource, context: TransactionContext) {
    super(dataSource, context);
  }

  private get repository() {
    return this.manager().getRepository(OwnerOrmEntity);
  }

  async findByUuid(uuid: string): Promise<Owner | null> {
    const row = await this.repository.findOne({ where: { uuid } });
    return row ? OwnerMapper.toDomain(row) : null;
  }

  async findByUserUuid(userUuid: string): Promise<Owner | null> {
    const row = await this.repository.findOne({ where: { userUuid } });
    return row ? OwnerMapper.toDomain(row) : null;
  }

  async list(params: PaginationParams): Promise<Page<Owner>> {
    const [rows, total] = await this.repository.findAndCount({
      order: { id: 'DESC' },
      skip: params.offset,
      take: params.limit,
    });

    return Page.of(
      rows.map((row) => OwnerMapper.toDomain(row)),
      total,
      params,
    );
  }

  async save(owner: Owner): Promise<void> {
    const existing = await this.repository.findOne({
      where: { uuid: owner.uuid },
      select: { id: true },
    });

    await this.repository.save(OwnerMapper.toOrm(owner, existing?.id));
  }
}
