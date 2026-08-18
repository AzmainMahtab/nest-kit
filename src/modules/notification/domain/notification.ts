import { uuidv7 } from 'uuidv7';

export const DeliveryStatus = {
  Queued: 'QUEUED',
  Sent: 'SENT',
  Failed: 'FAILED',
  /** No transport is configured. A credential fixes this; a resend does not. */
  Unconfigured: 'UNCONFIGURED',
} as const;

export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export function isDeliveryStatus(value: string): value is DeliveryStatus {
  return Object.values(DeliveryStatus).includes(value as DeliveryStatus);
}

export interface NotificationSnapshot {
  uuid: string;
  recipientUuid: string;
  recipientAddress: string;
  channel: string;
  subject: string;
  body: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Truncated on the way in: `last_error` is a diagnostic, not a log sink. */
const MAX_ERROR_LENGTH = 512;

/**
 * One attempt to reach a person, and the record of how it went.
 *
 * The recipient's address is **copied** here when the notification is queued
 * rather than joined from identity at send time. Two reasons, and both have
 * bitten real systems: a cross-context join would couple this table to
 * identity's (AGENTS.md §13), and an address looked up later is the address
 * *now*, not the one the customer had when the thing happened.
 */
export class Notification {
  private constructor(
    readonly uuid: string,
    readonly recipientUuid: string,
    readonly recipientAddress: string,
    readonly channel: string,
    readonly subject: string,
    readonly body: string,
    private _status: DeliveryStatus,
    private _attempts: number,
    private _lastError: string | null,
    private _sentAt: Date | null,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static queue(
    recipientUuid: string,
    recipientAddress: string,
    channel: string,
    subject: string,
    body: string,
    now: Date,
  ): Notification {
    return new Notification(
      uuidv7(),
      recipientUuid,
      recipientAddress,
      channel,
      subject,
      body,
      DeliveryStatus.Queued,
      0,
      null,
      null,
      now,
      now,
    );
  }

  static fromSnapshot(snapshot: NotificationSnapshot): Notification {
    return new Notification(
      snapshot.uuid,
      snapshot.recipientUuid,
      snapshot.recipientAddress,
      snapshot.channel,
      snapshot.subject,
      snapshot.body,
      snapshot.status,
      snapshot.attempts,
      snapshot.lastError,
      snapshot.sentAt,
      snapshot.createdAt,
      snapshot.updatedAt,
    );
  }

  get status(): DeliveryStatus {
    return this._status;
  }

  get attempts(): number {
    return this._attempts;
  }

  get lastError(): string | null {
    return this._lastError;
  }

  get sentAt(): Date | null {
    return this._sentAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /** Sent is terminal; everything else is worth another go once the cause is fixed. */
  get isDeliverable(): boolean {
    return this._status !== DeliveryStatus.Sent;
  }

  /**
   * Counts the attempt **before** it is made.
   *
   * A record written only on the way out cannot describe the send that crashed
   * the process — and that is exactly the case somebody telephones about. One
   * write buys a class of failure that is otherwise invisible by construction.
   */
  beginAttempt(now: Date): void {
    if (this._status === DeliveryStatus.Sent) {
      return;
    }
    this._attempts += 1;
    this._updatedAt = now;
  }

  markSent(now: Date): void {
    if (this._status === DeliveryStatus.Sent) {
      return;
    }
    this._status = DeliveryStatus.Sent;
    this._sentAt = now;
    this._lastError = null;
    this._updatedAt = now;
  }

  /**
   * Stays queued while attempts remain, so the next sweep picks it up. At the
   * cap it becomes `FAILED` — a state a human has to look at, rather than a
   * row that is retried forever and watched by nobody.
   */
  markFailed(error: string, maxAttempts: number, now: Date): void {
    if (this._status === DeliveryStatus.Sent) {
      return;
    }
    this._lastError = error.slice(0, MAX_ERROR_LENGTH);
    this._status = this._attempts >= maxAttempts ? DeliveryStatus.Failed : DeliveryStatus.Queued;
    this._updatedAt = now;
  }

  /** Does not consume an attempt: nothing was tried, and nothing was refused. */
  markUnconfigured(now: Date): void {
    if (this._status === DeliveryStatus.Sent) {
      return;
    }
    this._status = DeliveryStatus.Unconfigured;
    this._updatedAt = now;
  }
}
