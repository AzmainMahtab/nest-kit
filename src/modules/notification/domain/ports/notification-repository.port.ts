import { Notification } from '../notification';

export abstract class NotificationRepository {
  /** Upsert by uuid: the dispatcher saves the same notification several times. */
  abstract save(notification: Notification): Promise<void>;

  abstract listForRecipient(recipientUuid: string): Promise<Notification[]>;

  /**
   * Oldest first, so a backlog drains in the order it arrived rather than
   * leaving the earliest message permanently at the back of the queue.
   */
  abstract listQueued(limit: number): Promise<Notification[]>;
}
