import { Notification } from '../notification';

export abstract class NotificationRepository {
  abstract save(notification: Notification): Promise<void>;

  abstract listForRecipient(recipientUuid: string): Promise<Notification[]>;
}
