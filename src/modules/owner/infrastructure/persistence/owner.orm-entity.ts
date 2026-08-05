import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { OwnerStatus } from '../../domain/owner';

@Entity({ schema: 'owner', name: 'owners' })
export class OwnerOrmEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid', unique: true })
  uuid!: string;

  // identity owns the user table; this is an id, never a foreign key.
  @Column({ type: 'uuid', name: 'user_uuid', unique: true })
  userUuid!: string;

  @Column({ type: 'varchar', length: 512 })
  address!: string;

  @Column({ type: 'date', name: 'date_of_birth' })
  dateOfBirth!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: OwnerStatus;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
