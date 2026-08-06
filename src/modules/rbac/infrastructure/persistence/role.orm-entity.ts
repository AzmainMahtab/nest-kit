import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Persistence shape only. `id` is the internal BIGSERIAL and must never leave
 * this folder (AGENTS.md §5).
 */
@Entity({ schema: 'rbac', name: 'roles' })
export class RoleOrmEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid', unique: true })
  uuid!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  name!: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  description!: string;

  @Column({ type: 'boolean', name: 'is_protected', default: false })
  isProtected!: boolean;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
