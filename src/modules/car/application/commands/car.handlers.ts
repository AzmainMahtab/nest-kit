import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { OwnerRepository } from '../../../owner';
import { Clock, EventBus, UnitOfWork } from '../../../../shared/application';
import { Car } from '../../domain/car';
import { CarNotFound, OwnerNotAcceptingCars, PlateAlreadyRegistered } from '../../domain/errors';
import { CarRepository } from '../../domain/ports/car-repository.port';
import { LicensePlate } from '../../domain/value-objects/license-plate';
import { Money } from '../../domain/value-objects/money';
import {
  RegisterCarCommand,
  RepriceCarCommand,
  RetireCarCommand,
  TransferCarCommand,
} from './car.commands';

@CommandHandler(RegisterCarCommand)
export class RegisterCarHandler implements ICommandHandler<RegisterCarCommand, Car> {
  constructor(
    private readonly cars: CarRepository,
    // The owner context's port, from its public index — the same relationship
    // auth has with identity.
    private readonly owners: OwnerRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  execute(command: RegisterCarCommand): Promise<Car> {
    // Value objects are built before the transaction: a malformed plate is a
    // validation failure, and there is no reason to open a transaction for it.
    const licensePlate = LicensePlate.of(command.licensePlate);
    const price = Money.of(command.amount, command.currency);

    return this.uow.withTransaction(async () => {
      const owner = await this.owners.findByUuid(command.ownerUuid);

      if (!owner || !owner.isActive) {
        throw OwnerNotAcceptingCars();
      }

      if (await this.cars.findByPlate(licensePlate)) {
        throw PlateAlreadyRegistered();
      }

      const car = Car.register({
        ownerUuid: command.ownerUuid,
        make: command.make,
        model: command.model,
        year: command.year,
        colour: command.colour,
        licensePlate,
        price,
        now: this.clock.now(),
      });

      await this.cars.save(car);
      await this.events.publishAll(car.pullEvents());

      return car;
    });
  }
}

@CommandHandler(TransferCarCommand)
export class TransferCarHandler implements ICommandHandler<TransferCarCommand, Car> {
  constructor(
    private readonly cars: CarRepository,
    private readonly owners: OwnerRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  execute(command: TransferCarCommand): Promise<Car> {
    return this.uow.withTransaction(async () => {
      const car = await this.cars.findByUuid(command.uuid);

      if (!car) {
        throw CarNotFound();
      }

      const owner = await this.owners.findByUuid(command.toOwnerUuid);

      if (!owner || !owner.isActive) {
        throw OwnerNotAcceptingCars();
      }

      car.transferTo(command.toOwnerUuid, this.clock.now());
      await this.cars.save(car);
      await this.events.publishAll(car.pullEvents());

      return car;
    });
  }
}

@CommandHandler(RepriceCarCommand)
export class RepriceCarHandler implements ICommandHandler<RepriceCarCommand, Car> {
  constructor(
    private readonly cars: CarRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  execute(command: RepriceCarCommand): Promise<Car> {
    const price = Money.of(command.amount, command.currency);

    return this.uow.withTransaction(async () => {
      const car = await this.cars.findByUuid(command.uuid);

      if (!car) {
        throw CarNotFound();
      }

      car.reprice(price, this.clock.now());
      await this.cars.save(car);
      await this.events.publishAll(car.pullEvents());

      return car;
    });
  }
}

@CommandHandler(RetireCarCommand)
export class RetireCarHandler implements ICommandHandler<RetireCarCommand, Car> {
  constructor(
    private readonly cars: CarRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  execute(command: RetireCarCommand): Promise<Car> {
    return this.uow.withTransaction(async () => {
      const car = await this.cars.findByUuid(command.uuid);

      if (!car) {
        throw CarNotFound();
      }

      car.retire(command.reason, this.clock.now());
      await this.cars.save(car);
      await this.events.publishAll(car.pullEvents());

      return car;
    });
  }
}
