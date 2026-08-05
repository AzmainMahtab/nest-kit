import { Car, CarStatus, isCarStatus } from '../../domain/car';
import { LicensePlate } from '../../domain/value-objects/license-plate';
import { Money } from '../../domain/value-objects/money';
import { CarOrmEntity } from './car.orm-entity';

export const CarMapper = {
  toDomain(row: CarOrmEntity): Car {
    return Car.fromSnapshot({
      uuid: row.uuid,
      ownerUuid: row.ownerUuid,
      make: row.make,
      model: row.model,
      year: row.year,
      colour: row.colour,
      licensePlate: LicensePlate.fromPersistence(row.licensePlate),
      // Straight through as a string. Never Number(row.priceAmount).
      price: Money.fromPersistence(row.priceAmount, row.priceCurrency),
      status: isCarStatus(row.status) ? row.status : CarStatus.Retired,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  },

  toOrm(car: Car, internalId?: string): CarOrmEntity {
    const row = new CarOrmEntity();

    if (internalId !== undefined) {
      row.id = internalId;
    }

    row.uuid = car.uuid;
    row.ownerUuid = car.ownerUuid;
    row.make = car.make;
    row.model = car.model;
    row.year = car.year;
    row.colour = car.colour;
    row.licensePlate = car.licensePlate.value;
    row.priceAmount = car.price.amount;
    row.priceCurrency = car.price.currency;
    row.status = car.status;
    row.createdAt = car.createdAt;
    row.updatedAt = car.updatedAt;

    return row;
  },
};
