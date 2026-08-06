import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * The role → permission junction. Its identity is the pair, so it carries a
 * composite primary key and no uuid — the same shape as
 * `messaging.processed_events`. AGENTS.md §10's `id`/`uuid` template describes
 * aggregate tables; a surrogate key here would add an index that nothing reads.
 */
@Entity({ schema: 'rbac', name: 'role_permissions' })
export class RolePermissionOrmEntity {
  @PrimaryColumn({ type: 'bigint', name: 'role_id' })
  roleId!: string;

  @PrimaryColumn({ type: 'bigint', name: 'permission_id' })
  permissionId!: string;

  @Column({ type: 'uuid', name: 'granted_by', nullable: true })
  grantedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'granted_at' })
  grantedAt!: Date;
}
