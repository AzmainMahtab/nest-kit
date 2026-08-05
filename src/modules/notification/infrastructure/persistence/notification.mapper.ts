import { Notification } from '../../domain/notification';
import { NotificationOrmEntity } from './notification.orm-entity';

export const NotificationMapper = {
  toDomain(row: NotificationOrmEntity): Notification {
    return Notification.fromSnapshot({
      uuid: row.uuid,
      recipientUuid: row.recipientUuid,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      createdAt: row.createdAt,
    });
  },

  toOrm(notification: Notification): NotificationOrmEntity {
    const row = new NotificationOrmEntity();
    row.uuid = notification.uuid;
    row.recipientUuid = notification.recipientUuid;
    row.channel = notification.channel;
    row.subject = notification.subject;
    row.body = notification.body;
    row.createdAt = notification.createdAt;
    return row;
  },
};
