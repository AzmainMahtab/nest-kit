import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { TransactionContext, TransactionalRepository } from '../../../../platform/database';
import { DeliveryStatus, Notification } from '../../domain/notification';
import { NotificationRepository } from '../../domain/ports/notification-repository.port';
import { NotificationMapper } from './notification.mapper';
import { NotificationOrmEntity } from './notification.orm-entity';

@Injectable()
export class TypeOrmNotificationRepository
  extends TransactionalRepository
  implements NotificationRepository
{
  constructor(dataSource: DataSource, context: TransactionContext) {
    super(dataSource, context);
  }

  /**
   * Upsert on `uuid`, not `save`.
   *
   * The dispatcher writes the same notification three times — once to count
   * the attempt, once for the outcome, and again on the next sweep if it is
   * retried. `save()` on a mapped row carrying no primary key inserts every
   * time, so the second write would collide with the unique constraint the
   * first one created.
   */
  async save(notification: Notification): Promise<void> {
    await this.manager()
      .getRepository(NotificationOrmEntity)
      .upsert(NotificationMapper.toOrm(notification), ['uuid']);
  }

  async listForRecipient(recipientUuid: string): Promise<Notification[]> {
    const rows = await this.manager()
      .getRepository(NotificationOrmEntity)
      .find({ where: { recipientUuid }, order: { id: 'DESC' } });

    return rows.map((row) => NotificationMapper.toDomain(row));
  }

  async listQueued(limit: number): Promise<Notification[]> {
    const rows = await this.manager()
      .getRepository(NotificationOrmEntity)
      .find({ where: { status: DeliveryStatus.Queued }, order: { id: 'ASC' }, take: limit });

    return rows.map((row) => NotificationMapper.toDomain(row));
  }
}
