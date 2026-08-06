import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';

import { TransactionContext, TransactionalRepository } from '../../../../platform/database';
import { Grants } from '../../../../shared/application';
import { Page, PaginationParams } from '../../../../shared/pagination';
import { RoleNotFound } from '../../domain/errors';
import { Permission } from '../../domain/permission';
import { RbacRepository } from '../../domain/ports/rbac-repository.port';
import { PermissionGrant, Role } from '../../domain/role';
import { RoleAssignment } from '../../domain/role-assignment';
import { PermissionName } from '../../domain/value-objects/permission-name';
import { RoleName } from '../../domain/value-objects/role-name';
import { PermissionOrmEntity } from './permission.orm-entity';
import { PermissionMapper, RoleMapper } from './rbac.mapper';
import { RolePermissionOrmEntity } from './role-permission.orm-entity';
import { RoleOrmEntity } from './role.orm-entity';
import { UserRoleOrmEntity } from './user-role.orm-entity';

interface GrantRow {
  role_name: string;
  permission_name: string | null;
}

@Injectable()
export class TypeOrmRbacRepository extends TransactionalRepository implements RbacRepository {
  constructor(dataSource: DataSource, context: TransactionContext) {
    super(dataSource, context);
  }

  private get permissions() {
    return this.manager().getRepository(PermissionOrmEntity);
  }

  private get roles() {
    return this.manager().getRepository(RoleOrmEntity);
  }

  private get rolePermissions() {
    return this.manager().getRepository(RolePermissionOrmEntity);
  }

  private get userRoles() {
    return this.manager().getRepository(UserRoleOrmEntity);
  }

  async findPermissionByName(name: PermissionName): Promise<Permission | null> {
    const row = await this.permissions.findOne({ where: { name: name.value } });
    return row ? PermissionMapper.toDomain(row) : null;
  }

  async findPermissionByUuid(uuid: string): Promise<Permission | null> {
    const row = await this.permissions.findOne({ where: { uuid } });
    return row ? PermissionMapper.toDomain(row) : null;
  }

  async listPermissions(params: PaginationParams): Promise<Page<Permission>> {
    const [rows, total] = await this.permissions.findAndCount({
      order: { name: 'ASC' },
      skip: params.offset,
      take: params.limit,
    });

    return Page.of(
      rows.map((row) => PermissionMapper.toDomain(row)),
      total,
      params,
    );
  }

  async savePermission(permission: Permission): Promise<void> {
    const existing = await this.permissions.findOne({
      where: { uuid: permission.uuid },
      select: { id: true },
    });

    await this.permissions.save(PermissionMapper.toOrm(permission, existing?.id));
  }

  async findRoleByName(name: RoleName): Promise<Role | null> {
    return this.hydrate(await this.roles.findOne({ where: { name: name.value } }));
  }

  async findRoleByUuid(uuid: string): Promise<Role | null> {
    return this.hydrate(await this.roles.findOne({ where: { uuid } }));
  }

  async listRoles(params: PaginationParams): Promise<Page<Role>> {
    const [rows, total] = await this.roles.findAndCount({
      order: { name: 'ASC' },
      skip: params.offset,
      take: params.limit,
    });

    // One grant query for the whole page, not one per role.
    const grants = await this.loadGrants(rows.map((row) => String(row.id)));

    return Page.of(
      rows.map((row) => RoleMapper.toDomain(row, grants.get(String(row.id)) ?? [])),
      total,
      params,
    );
  }

  async saveRole(role: Role): Promise<void> {
    const existing = await this.roles.findOne({
      where: { uuid: role.uuid },
      select: { id: true },
    });

    const saved = await this.roles.save(RoleMapper.toOrm(role, existing?.id));
    await this.reconcileGrants(String(saved.id), role);
  }

  async assignRole(
    userUuid: string,
    role: Role,
    assignedBy: string | null,
    now: Date,
  ): Promise<void> {
    const roleId = await this.internalRoleId(role.uuid);

    // ON CONFLICT DO NOTHING rather than an upsert: re-assigning a role the user
    // already holds must not rewrite `assigned_by`/`assigned_at`, which would
    // erase who originally granted it.
    await this.userRoles
      .createQueryBuilder()
      .insert()
      .into(UserRoleOrmEntity)
      .values({ userUuid, roleId, assignedBy, assignedAt: now })
      .orIgnore()
      .execute();
  }

  async unassignRole(userUuid: string, role: Role): Promise<void> {
    const roleId = await this.internalRoleId(role.uuid);
    await this.userRoles.delete({ userUuid, roleId });
  }

  async findAssignmentsForUser(userUuid: string): Promise<RoleAssignment[]> {
    const links = await this.userRoles.find({ where: { userUuid } });

    if (links.length === 0) {
      return [];
    }

    const roleIds = links.map((link) => String(link.roleId));
    const rows = await this.roles.find({ where: { id: In(roleIds) } });
    const grants = await this.loadGrants(rows.map((row) => String(row.id)));

    const byId = new Map(
      rows.map((row) => [
        String(row.id),
        RoleMapper.toDomain(row, grants.get(String(row.id)) ?? []),
      ]),
    );

    return links.flatMap((link) => {
      const role = byId.get(String(link.roleId));

      return role
        ? [{ userUuid, role, assignedBy: link.assignedBy, assignedAt: link.assignedAt }]
        : [];
    });
  }

  async findUserUuidsForRole(roleUuid: string): Promise<string[]> {
    const row = await this.roles.findOne({ where: { uuid: roleUuid }, select: { id: true } });

    if (!row) {
      return [];
    }

    const links = await this.userRoles.find({
      where: { roleId: String(row.id) },
      select: { userUuid: true },
    });

    return links.map((link) => link.userUuid);
  }

  /**
   * Raw SQL, deliberately: this runs on every authorized request, and the ORM
   * path would be three round trips to answer what one join answers. The LEFT
   * JOINs keep a role with no permissions in the result, so a user holding only
   * such a role still reports the role.
   */
  async grantsFor(userUuid: string): Promise<Grants> {
    const rows = await this.manager().query<GrantRow[]>(
      `SELECT r.name AS role_name, p.name AS permission_name
         FROM rbac.user_roles ur
         JOIN rbac.roles r ON r.id = ur.role_id
    LEFT JOIN rbac.role_permissions rp ON rp.role_id = r.id
    LEFT JOIN rbac.permissions p ON p.id = rp.permission_id
        WHERE ur.user_uuid = $1`,
      [userUuid],
    );

    const roles = new Set<string>();
    const permissions = new Set<string>();

    for (const row of rows) {
      roles.add(row.role_name);

      if (row.permission_name !== null) {
        permissions.add(row.permission_name);
      }
    }

    return { roles: [...roles], permissions: [...permissions] };
  }

  private async hydrate(row: RoleOrmEntity | null): Promise<Role | null> {
    if (!row) {
      return null;
    }

    const grants = await this.loadGrants([String(row.id)]);

    return RoleMapper.toDomain(row, grants.get(String(row.id)) ?? []);
  }

  private async loadGrants(roleIds: string[]): Promise<Map<string, PermissionGrant[]>> {
    const byRole = new Map<string, PermissionGrant[]>();

    if (roleIds.length === 0) {
      return byRole;
    }

    const links = await this.rolePermissions.find({ where: { roleId: In(roleIds) } });

    if (links.length === 0) {
      return byRole;
    }

    const rows = await this.permissions.find({
      where: { id: In([...new Set(links.map((link) => String(link.permissionId)))]) },
    });

    const byId = new Map(rows.map((row) => [String(row.id), PermissionMapper.toDomain(row)]));

    for (const link of links) {
      const permission = byId.get(String(link.permissionId));

      if (!permission) {
        continue;
      }

      const roleId = String(link.roleId);
      const grants = byRole.get(roleId) ?? [];
      grants.push({ permission, grantedBy: link.grantedBy, grantedAt: link.grantedAt });
      byRole.set(roleId, grants);
    }

    return byRole;
  }

  /**
   * Reconciles the junction against the aggregate rather than deleting and
   * reinserting every row: a blind rewrite would reset `granted_by`/`granted_at`
   * on grants that did not change, destroying the audit trail the columns exist
   * for.
   */
  private async reconcileGrants(roleId: string, role: Role): Promise<void> {
    const wanted = role.grants;
    const uuids = wanted.map((grant) => grant.permission.uuid);

    const rows = uuids.length
      ? await this.permissions.find({
          where: { uuid: In(uuids) },
          select: { id: true, uuid: true },
        })
      : [];

    const idByUuid = new Map(rows.map((row) => [row.uuid, String(row.id)]));
    const wantedIds = new Set(
      wanted.flatMap((grant) => {
        const id = idByUuid.get(grant.permission.uuid);
        return id ? [id] : [];
      }),
    );

    const existing = await this.rolePermissions.find({ where: { roleId } });
    const existingIds = new Set(existing.map((link) => String(link.permissionId)));

    const stale = existing
      .map((link) => String(link.permissionId))
      .filter((id) => !wantedIds.has(id));

    if (stale.length > 0) {
      await this.rolePermissions.delete({ roleId, permissionId: In(stale) });
    }

    const added = wanted.flatMap((grant) => {
      const permissionId = idByUuid.get(grant.permission.uuid);

      if (!permissionId || existingIds.has(permissionId)) {
        return [];
      }

      return [
        {
          roleId,
          permissionId,
          grantedBy: grant.grantedBy,
          grantedAt: grant.grantedAt,
        },
      ];
    });

    if (added.length > 0) {
      await this.rolePermissions.insert(added);
    }
  }

  private async internalRoleId(uuid: string): Promise<string> {
    const row = await this.roles.findOne({ where: { uuid }, select: { id: true } });

    if (!row) {
      throw RoleNotFound();
    }

    return String(row.id);
  }
}
