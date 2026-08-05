import { uuidv7 } from 'uuidv7';

export interface NotificationSnapshot {
  uuid: string;
  recipientUuid: string;
  channel: string;
  subject: string;
  body: string;
  createdAt: Date;
}

export class Notification {
  private constructor(
    readonly uuid: string,
    readonly recipientUuid: string,
    readonly channel: string,
    readonly subject: string,
    readonly body: string,
    readonly createdAt: Date,
  ) {}

  static queue(
    recipientUuid: string,
    channel: string,
    subject: string,
    body: string,
    now: Date,
  ): Notification {
    return new Notification(uuidv7(), recipientUuid, channel, subject, body, now);
  }

  static fromSnapshot(snapshot: NotificationSnapshot): Notification {
    return new Notification(
      snapshot.uuid,
      snapshot.recipientUuid,
      snapshot.channel,
      snapshot.subject,
      snapshot.body,
      snapshot.createdAt,
    );
  }
}
