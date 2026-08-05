import { uuidv7 } from 'uuidv7';

import { DomainEvent } from '../../../shared/domain';
import { AppError } from '../../../shared/errors';
import { OwnerAddressChanged, OwnerDeactivated, OwnerReactivated, OwnerRegistered } from './events';
import { DateOfBirth } from './value-objects/date-of-birth';

export const OwnerStatus = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const;

export type OwnerStatus = (typeof OwnerStatus)[keyof typeof OwnerStatus];

export function isOwnerStatus(value: string): value is OwnerStatus {
  return Object.values(OwnerStatus).includes(value as OwnerStatus);
}

export interface OwnerSnapshot {
  uuid: string;
  userUuid: string;
  address: string;
  dateOfBirth: DateOfBirth;
  status: OwnerStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * An owner of cars, linked to a user in the identity context by uuid only —
 * never by a foreign key, so either context can be extracted (AGENTS.md §13).
 */
export class Owner {
  private readonly events: DomainEvent[] = [];

  private constructor(
    readonly uuid: string,
    readonly userUuid: string,
    private _address: string,
    readonly dateOfBirth: DateOfBirth,
    private _status: OwnerStatus,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static register(userUuid: string, address: string, dateOfBirth: DateOfBirth, now: Date): Owner {
    const owner = new Owner(
      uuidv7(),
      userUuid,
      normaliseAddress(address),
      dateOfBirth,
      OwnerStatus.Active,
      now,
      now,
    );

    owner.record(new OwnerRegistered(owner.uuid, userUuid));
    return owner;
  }

  static fromSnapshot(snapshot: OwnerSnapshot): Owner {
    return new Owner(
      snapshot.uuid,
      snapshot.userUuid,
      snapshot.address,
      snapshot.dateOfBirth,
      snapshot.status,
      snapshot.createdAt,
      snapshot.updatedAt,
    );
  }

  get address(): string {
    return this._address;
  }

  get status(): OwnerStatus {
    return this._status;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get isActive(): boolean {
    return this._status === OwnerStatus.Active;
  }

  changeAddress(address: string, now: Date): void {
    this.assertActive();

    const next = normaliseAddress(address);

    if (next === this._address) {
      return;
    }

    this._address = next;
    this._updatedAt = now;
    this.record(new OwnerAddressChanged(this.uuid, next));
  }

  /**
   * Idempotent, because the caller may be a redelivered event rather than a
   * person — the car context's reaction must not depend on how many times this
   * arrives.
   */
  deactivate(reason: string, now: Date): void {
    if (!this.isActive) {
      return;
    }

    this._status = OwnerStatus.Inactive;
    this._updatedAt = now;
    this.record(new OwnerDeactivated(this.uuid, reason));
  }

  reactivate(now: Date): void {
    if (this.isActive) {
      return;
    }

    this._status = OwnerStatus.Active;
    this._updatedAt = now;
    this.record(new OwnerReactivated(this.uuid));
  }

  pullEvents(): DomainEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private assertActive(): void {
    if (!this.isActive) {
      throw AppError.conflict('OWNER_INACTIVE', 'owner is not active');
    }
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}

function normaliseAddress(address: string): string {
  const trimmed = address.trim().replace(/\s+/g, ' ');

  if (trimmed.length === 0) {
    throw AppError.validation('address', 'must not be empty');
  }

  if (trimmed.length > 512) {
    throw AppError.validation('address', 'must be at most 512 characters');
  }

  return trimmed;
}
