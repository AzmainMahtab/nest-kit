import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * The user → role junction.
 *
 * `user_uuid` is an id, not a foreign key: identity owns the users table, and a
 * cross-schema FK would have to be dropped before either context could be
 * extracted (AGENTS.md §13). `role_id` is a real FK — the role lives in this
 * schema.
 */
@Entity({ schema: 'rbac', name: 'user_roles' })
export class UserRoleOrmEntity {
  @PrimaryColumn({ type: 'uuid', name: 'user_uuid' })
  userUuid!: string;

  @PrimaryColumn({ type: 'bigint', name: 'role_id' })
  roleId!: string;

  @Column({ type: 'uuid', name: 'assigned_by', nullable: true })
  assignedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'assigned_at' })
  assignedAt!: Date;
}
