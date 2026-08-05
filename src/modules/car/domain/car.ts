import { uuidv7 } from 'uuidv7';

import { DomainEvent } from '../../../shared/domain';
import { AppError } from '../../../shared/errors';
import { CarRegistered, CarRepriced, CarRetired, CarTransferred } from './events';
import { CarRetiredError, SameOwnerTransfer } from './errors';
import { LicensePlate } from './value-objects/license-plate';
import { Money } from './value-objects/money';

export const CarStatus = {
  Active: 'ACTIVE',
  Retired: 'RETIRED',
} as const;

export type CarStatus = (typeof CarStatus)[keyof typeof CarStatus];

export function isCarStatus(value: string): value is CarStatus {
  return Object.values(CarStatus).includes(value as CarStatus);
}

const EARLIEST_YEAR = 1886; // Benz Patent-Motorwagen.

export interface CarSnapshot {
  uuid: string;
  ownerUuid: string;
  make: string;
  model: string;
  year: number;
  colour: string;
  licensePlate: LicensePlate;
  price: Money;
  status: CarStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class Car {
  private readonly events: DomainEvent[] = [];

  private constructor(
    readonly uuid: string,
    private _ownerUuid: string,
    readonly make: string,
    readonly model: string,
    readonly year: number,
    readonly colour: string,
    readonly licensePlate: LicensePlate,
    private _price: Money,
    private _status: CarStatus,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static register(input: {
    ownerUuid: string;
    make: string;
    model: string;
    year: number;
    colour: string;
    licensePlate: LicensePlate;
    price: Money;
    now: Date;
  }): Car {
    const year = assertYear(input.year, input.now);

    const car = new Car(
      uuidv7(),
      input.ownerUuid,
      requireText(input.make, 'make', 64),
      requireText(input.model, 'model', 64),
      year,
      requireText(input.colour, 'colour', 32),
      input.licensePlate,
      input.price,
      CarStatus.Active,
      input.now,
      input.now,
    );

    car.record(new CarRegistered(car.uuid, car._ownerUuid, input.licensePlate.value));
    return car;
  }

  static fromSnapshot(snapshot: CarSnapshot): Car {
    return new Car(
      snapshot.uuid,
      snapshot.ownerUuid,
      snapshot.make,
      snapshot.model,
      snapshot.year,
      snapshot.colour,
      snapshot.licensePlate,
      snapshot.price,
      snapshot.status,
      snapshot.createdAt,
      snapshot.updatedAt,
    );
  }

  get ownerUuid(): string {
    return this._ownerUuid;
  }

  get price(): Money {
    return this._price;
  }

  get status(): CarStatus {
    return this._status;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get isRetired(): boolean {
    return this._status === CarStatus.Retired;
  }

  transferTo(newOwnerUuid: string, now: Date): void {
    this.assertNotRetired();

    if (newOwnerUuid === this._ownerUuid) {
      throw SameOwnerTransfer();
    }

    const previous = this._ownerUuid;
    this._ownerUuid = newOwnerUuid;
    this._updatedAt = now;
    this.record(new CarTransferred(this.uuid, previous, newOwnerUuid));
  }

  reprice(price: Money, now: Date): void {
    this.assertNotRetired();

    if (this._price.equals(price)) {
      return;
    }

    this._price = price;
    this._updatedAt = now;
    this.record(new CarRepriced(this.uuid, price.amount, price.currency));
  }

  /**
   * Idempotent: the usual caller is a redelivered `owner.owner.deactivated`,
   * and retiring twice must not emit twice.
   */
  retire(reason: string, now: Date): void {
    if (this.isRetired) {
      return;
    }

    this._status = CarStatus.Retired;
    this._updatedAt = now;
    this.record(new CarRetired(this.uuid, reason));
  }

  pullEvents(): DomainEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private assertNotRetired(): void {
    if (this.isRetired) {
      throw CarRetiredError();
    }
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}

function requireText(value: string, field: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');

  if (trimmed.length === 0) {
    throw AppError.validation(field, 'must not be empty');
  }

  if (trimmed.length > max) {
    throw AppError.validation(field, `must be at most ${max} characters`);
  }

  return trimmed;
}

function assertYear(year: number, now: Date): number {
  // Next year is legitimate — model years run ahead of the calendar.
  const latest = now.getUTCFullYear() + 1;

  if (!Number.isInteger(year) || year < EARLIEST_YEAR || year > latest) {
    throw AppError.validation('year', `must be between ${EARLIEST_YEAR} and ${latest}`);
  }

  return year;
}
