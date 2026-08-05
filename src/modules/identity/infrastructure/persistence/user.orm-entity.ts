import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { UserStatus } from '../../domain/user-status';

/**
 * Persistence shape only. `id` is the internal BIGSERIAL and must never leave
 * this folder — the domain and every wire contract use `uuid` (AGENTS.md §5).
 */
@Entity({ schema: 'identity', name: 'users' })
export class UserOrmEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid', unique: true })
  uuid!: string;

  // Uniqueness is a *partial* index (live rows only) declared in the migration.
  // It is deliberately not modelled here — migrations own the schema.
  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ type: 'text', name: 'password_hash' })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: UserStatus;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
