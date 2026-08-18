import { DeliveryStatus, isDeliveryStatus, Notification } from '../../domain/notification';
import { NotificationOrmEntity } from './notification.orm-entity';

export const NotificationMapper = {
  toDomain(row: NotificationOrmEntity): Notification {
    return Notification.fromSnapshot({
      uuid: row.uuid,
      recipientUuid: row.recipientUuid,
      recipientAddress: row.recipientAddress,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      // A status the code no longer knows is treated as needing attention
      // rather than crashing the sweep on one bad row.
      status: isDeliveryStatus(row.status) ? row.status : DeliveryStatus.Failed,
      attempts: row.attempts,
      lastError: row.lastError,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  },

  toOrm(notification: Notification): NotificationOrmEntity {
    const row = new NotificationOrmEntity();
    row.uuid = notification.uuid;
    row.recipientUuid = notification.recipientUuid;
    row.recipientAddress = notification.recipientAddress;
    row.channel = notification.channel;
    row.subject = notification.subject;
    row.body = notification.body;
    row.status = notification.status;
    row.attempts = notification.attempts;
    row.lastError = notification.lastError;
    row.sentAt = notification.sentAt;
    row.createdAt = notification.createdAt;
    row.updatedAt = notification.updatedAt;
    return row;
  },
};
