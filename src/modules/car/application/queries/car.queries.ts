import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { Page, PaginationParams } from '../../../../shared/pagination';
import { Car } from '../../domain/car';
import { CarNotFound } from '../../domain/errors';
import { CarRepository } from '../../domain/ports/car-repository.port';

export class GetCarQuery {
  constructor(readonly uuid: string) {}
}

export class ListCarsQuery {
  constructor(
    readonly pagination: PaginationParams,
    readonly ownerUuid?: string,
  ) {}
}

@QueryHandler(GetCarQuery)
export class GetCarHandler implements IQueryHandler<GetCarQuery, Car> {
  constructor(private readonly cars: CarRepository) {}

  async execute(query: GetCarQuery): Promise<Car> {
    const car = await this.cars.findByUuid(query.uuid);

    if (!car) {
      throw CarNotFound();
    }

    return car;
  }
}

@QueryHandler(ListCarsQuery)
export class ListCarsHandler implements IQueryHandler<ListCarsQuery, Page<Car>> {
  constructor(private readonly cars: CarRepository) {}

  execute(query: ListCarsQuery): Promise<Page<Car>> {
    return this.cars.list(query.pagination, query.ownerUuid);
  }
}
