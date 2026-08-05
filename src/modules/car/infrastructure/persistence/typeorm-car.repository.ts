import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { TransactionContext, TransactionalRepository } from '../../../../platform/database';
import { Page, PaginationParams } from '../../../../shared/pagination';
import { Car, CarStatus } from '../../domain/car';
import { CarRepository } from '../../domain/ports/car-repository.port';
import { LicensePlate } from '../../domain/value-objects/license-plate';
import { CarMapper } from './car.mapper';
import { CarOrmEntity } from './car.orm-entity';

@Injectable()
export class TypeOrmCarRepository extends TransactionalRepository implements CarRepository {
  constructor(dataSource: DataSource, context: TransactionContext) {
    super(dataSource, context);
  }

  private get repository() {
    return this.manager().getRepository(CarOrmEntity);
  }

  async findByUuid(uuid: string): Promise<Car | null> {
    const row = await this.repository.findOne({ where: { uuid } });
    return row ? CarMapper.toDomain(row) : null;
  }

  async findByPlate(plate: LicensePlate): Promise<Car | null> {
    const row = await this.repository.findOne({ where: { licensePlate: plate.value } });
    return row ? CarMapper.toDomain(row) : null;
  }

  async list(params: PaginationParams, ownerUuid?: string): Promise<Page<Car>> {
    const [rows, total] = await this.repository.findAndCount({
      where: ownerUuid ? { ownerUuid } : {},
      order: { id: 'DESC' },
      skip: params.offset,
      take: params.limit,
    });

    return Page.of(
      rows.map((row) => CarMapper.toDomain(row)),
      total,
      params,
    );
  }

  async findActiveByOwner(ownerUuid: string): Promise<Car[]> {
    const rows = await this.repository.find({
      where: { ownerUuid, status: CarStatus.Active },
      order: { id: 'ASC' },
    });

    return rows.map((row) => CarMapper.toDomain(row));
  }

  async save(car: Car): Promise<void> {
    const existing = await this.repository.findOne({
      where: { uuid: car.uuid },
      select: { id: true },
    });

    await this.repository.save(CarMapper.toOrm(car, existing?.id));
  }

  /**
   * One statement for the batch. The caller already holds a transaction, so
   * this is about round trips rather than atomicity.
   */
  async saveAll(cars: readonly Car[]): Promise<void> {
    if (cars.length === 0) {
      return;
    }

    const existing = await this.repository.find({
      where: cars.map((car) => ({ uuid: car.uuid })),
      select: { id: true, uuid: true },
    });

    const idByUuid = new Map(existing.map((row) => [row.uuid, row.id]));

    await this.repository.save(cars.map((car) => CarMapper.toOrm(car, idByUuid.get(car.uuid))));
  }
}
