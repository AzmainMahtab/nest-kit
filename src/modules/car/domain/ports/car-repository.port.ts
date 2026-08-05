import { Page, PaginationParams } from '../../../../shared/pagination';
import { Car } from '../car';
import { LicensePlate } from '../value-objects/license-plate';

export abstract class CarRepository {
  abstract findByUuid(uuid: string): Promise<Car | null>;

  abstract findByPlate(plate: LicensePlate): Promise<Car | null>;

  abstract list(params: PaginationParams, ownerUuid?: string): Promise<Page<Car>>;

  /** Every active car for an owner — the deactivation reaction walks these. */
  abstract findActiveByOwner(ownerUuid: string): Promise<Car[]>;

  abstract save(car: Car): Promise<void>;

  abstract saveAll(cars: readonly Car[]): Promise<void>;
}
