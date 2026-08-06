import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Persistence shape only. `id` is the internal BIGSERIAL and must never leave
 * this folder — the domain and every wire contract use `uuid` (AGENTS.md §5).
 */
@Entity({ schema: 'rbac', name: 'permissions' })
export class PermissionOrmEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid', unique: true })
  uuid!: string;

  @Column({ type: 'varchar', length: 128, unique: true })
  name!: string;

  // Stored alongside `name` rather than derived on read: "every permission on
  // this resource" is an indexed query, and re-splitting the string in SQL
  // would forfeit the index.
  @Column({ type: 'varchar', length: 64 })
  resource!: string;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  description!: string;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
