import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { CarStatus } from '../../domain/car';

@Entity({ schema: 'car', name: 'cars' })
export class CarOrmEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid', unique: true })
  uuid!: string;

  // The owner context owns its table; this is an id, never a foreign key.
  @Column({ type: 'uuid', name: 'owner_uuid' })
  ownerUuid!: string;

  @Column({ type: 'varchar', length: 64 })
  make!: string;

  @Column({ type: 'varchar', length: 64 })
  model!: string;

  @Column({ type: 'integer' })
  year!: number;

  @Column({ type: 'varchar', length: 32 })
  colour!: string;

  @Column({ type: 'varchar', length: 16, name: 'license_plate' })
  licensePlate!: string;

  // NUMERIC, and typed `string` deliberately — the pg driver returns it as a
  // string and it must stay one all the way to the wire (AGENTS.md §7).
  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'price_amount' })
  priceAmount!: string;

  @Column({ type: 'char', length: 3, name: 'price_currency' })
  priceCurrency!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: CarStatus;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
