import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';

import { TransactionContext, TransactionalRepository } from '../../../../platform/database';
import { SessionRepository } from '../../domain/ports/session-repository.port';
import { Session } from '../../domain/session';
import { SessionMapper } from './session.mapper';
import { SessionOrmEntity } from './session.orm-entity';

@Injectable()
export class TypeOrmSessionRepository extends TransactionalRepository implements SessionRepository {
  constructor(dataSource: DataSource, context: TransactionContext) {
    super(dataSource, context);
  }

  private get repository() {
    return this.manager().getRepository(SessionOrmEntity);
  }

  async findByUuid(uuid: string): Promise<Session | null> {
    const row = await this.repository.findOne({ where: { uuid } });
    return row ? SessionMapper.toDomain(row) : null;
  }

  async save(session: Session): Promise<void> {
    const existing = await this.repository.findOne({
      where: { uuid: session.uuid },
      select: { id: true },
    });

    await this.repository.save(SessionMapper.toOrm(session, existing?.id));
  }

  async revokeAllForUser(userUuid: string, now: Date): Promise<void> {
    await this.repository.update({ userUuid, revokedAt: IsNull() }, { revokedAt: now });
  }
}
