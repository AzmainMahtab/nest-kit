import { Module } from '@nestjs/common';

import { OwnerModule } from '../owner';
import {
  RegisterCarHandler,
  RepriceCarHandler,
  RetireCarHandler,
  TransferCarHandler,
} from './application/commands/car.handlers';
import { GetCarHandler, ListCarsHandler } from './application/queries/car.queries';
import { CarRepository } from './domain/ports/car-repository.port';
import { RetireCarsOnOwnerDeactivated } from './infrastructure/event-handlers/retire-on-owner-deactivated.handler';
import { TypeOrmCarRepository } from './infrastructure/persistence/typeorm-car.repository';
import { CarsController } from './presentation/http/cars.controller';

@Module({
  // For owner's OwnerRepository port only.
  imports: [OwnerModule],
  controllers: [CarsController],
  providers: [
    { provide: CarRepository, useClass: TypeOrmCarRepository },
    RegisterCarHandler,
    TransferCarHandler,
    RepriceCarHandler,
    RetireCarHandler,
    GetCarHandler,
    ListCarsHandler,
    RetireCarsOnOwnerDeactivated,
  ],
  exports: [CarRepository],
})
export class CarModule {}
