import { uuidv7 } from 'uuidv7';

import { DomainEvent } from '../../../shared/domain';
import { UserDeleted, UserEmailChanged, UserRegistered, UserStatusChanged } from './events';
import { InvalidStatusTransition, UserAlreadyDeleted } from './errors';
import { UserStatus } from './user-status';
import { Email } from './value-objects/email';

export interface UserSnapshot {
  uuid: string;
  email: Email;
  passwordHash: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * The aggregate root. Carries no internal database key — the BIGSERIAL exists
 * only inside infrastructure/persistence (AGENTS.md §5).
 *
 * Events are collected here and drained by the use case after the write
 * succeeds. The entity does not publish: it has no bus, and publishing from
 * inside the domain would either couple it to the framework or emit events for
 * writes that later roll back.
 */
export class User {
  private readonly events: DomainEvent[] = [];

  private constructor(
    readonly uuid: string,
    private _email: Email,
    private _passwordHash: string,
    private _status: UserStatus,
    readonly createdAt: Date,
    private _updatedAt: Date,
    private _deletedAt: Date | null,
  ) {}

  static register(email: Email, passwordHash: string, now: Date): User {
    const user = new User(uuidv7(), email, passwordHash, UserStatus.Pending, now, now, null);
    user.record(new UserRegistered(user.uuid, email.value));
    return user;
  }

  /** Rehydration from persistence. Records no events. */
  static fromSnapshot(snapshot: UserSnapshot): User {
    return new User(
      snapshot.uuid,
      snapshot.email,
      snapshot.passwordHash,
      snapshot.status,
      snapshot.createdAt,
      snapshot.updatedAt,
      snapshot.deletedAt,
    );
  }

  get email(): Email {
    return this._email;
  }

  get passwordHash(): string {
    return this._passwordHash;
  }

  get status(): UserStatus {
    return this._status;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get deletedAt(): Date | null {
    return this._deletedAt;
  }

  get isDeleted(): boolean {
    return this._deletedAt !== null;
  }

  changeEmail(email: Email, now: Date): void {
    this.assertNotDeleted();

    if (this._email.equals(email)) {
      return;
    }

    const previous = this._email;
    this._email = email;
    this.touch(now);
    this.record(new UserEmailChanged(this.uuid, previous.value, email.value));
  }

  changeStatus(status: UserStatus, now: Date): void {
    this.assertNotDeleted();

    if (this._status === status) {
      return;
    }

    // A suspended account must be reinstated explicitly, never by drifting back
    // through the pending state a registration flow would set.
    if (this._status === UserStatus.Suspended && status === UserStatus.Pending) {
      throw InvalidStatusTransition(this._status, status);
    }

    const previous = this._status;
    this._status = status;
    this.touch(now);
    this.record(new UserStatusChanged(this.uuid, previous, status));
  }

  delete(now: Date): void {
    this.assertNotDeleted();

    this._deletedAt = now;
    this.touch(now);
    this.record(new UserDeleted(this.uuid));
  }

  /** Returns the recorded events and clears them, so a re-save cannot re-emit. */
  pullEvents(): DomainEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private assertNotDeleted(): void {
    if (this.isDeleted) {
      throw UserAlreadyDeleted();
    }
  }

  private touch(now: Date): void {
    this._updatedAt = now;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
