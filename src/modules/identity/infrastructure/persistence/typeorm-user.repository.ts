import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';

import { TransactionContext, TransactionalRepository } from '../../../../platform/database';
import { Page, PaginationParams } from '../../../../shared/pagination';
import { UserRepository } from '../../domain/ports/user-repository.port';
import { User } from '../../domain/user';
import { Email } from '../../domain/value-objects/email';
import { UserMapper } from './user.mapper';
import { UserOrmEntity } from './user.orm-entity';

@Injectable()
export class TypeOrmUserRepository extends TransactionalRepository implements UserRepository {
  constructor(dataSource: DataSource, context: TransactionContext) {
    super(dataSource, context);
  }

  private get repository() {
    return this.manager().getRepository(UserOrmEntity);
  }

  async findByUuid(uuid: string): Promise<User | null> {
    const row = await this.repository.findOne({ where: { uuid } });
    return row ? UserMapper.toDomain(row) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const row = await this.repository.findOne({
      where: { email: email.value, deletedAt: IsNull() },
    });
    return row ? UserMapper.toDomain(row) : null;
  }

  async list(params: PaginationParams): Promise<Page<User>> {
    const [rows, total] = await this.repository.findAndCount({
      where: { deletedAt: IsNull() },
      order: { id: 'DESC' },
      skip: params.offset,
      take: params.limit,
    });

    return Page.of(
      rows.map((row) => UserMapper.toDomain(row)),
      total,
      params,
    );
  }

  /**
   * Resolves the internal key by uuid before writing, so the BIGSERIAL is
   * preserved on update and never has to travel through the domain.
   */
  async save(user: User): Promise<void> {
    const existing = await this.repository.findOne({
      where: { uuid: user.uuid },
      select: { id: true },
    });

    await this.repository.save(UserMapper.toOrm(user, existing?.id));
  }
}
