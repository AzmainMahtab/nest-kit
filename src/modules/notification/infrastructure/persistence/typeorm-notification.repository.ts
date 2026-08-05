import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { TransactionContext, TransactionalRepository } from '../../../../platform/database';
import { Notification } from '../../domain/notification';
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

  async save(notification: Notification): Promise<void> {
    await this.manager()
      .getRepository(NotificationOrmEntity)
      .save(NotificationMapper.toOrm(notification));
  }

  async listForRecipient(recipientUuid: string): Promise<Notification[]> {
    const rows = await this.manager()
      .getRepository(NotificationOrmEntity)
      .find({ where: { recipientUuid }, order: { id: 'DESC' } });

    return rows.map((row) => NotificationMapper.toDomain(row));
  }
}
