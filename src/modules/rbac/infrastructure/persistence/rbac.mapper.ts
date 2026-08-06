import { Permission } from '../../domain/permission';
import { PermissionGrant, Role } from '../../domain/role';
import { PermissionName } from '../../domain/value-objects/permission-name';
import { RoleName } from '../../domain/value-objects/role-name';
import { PermissionOrmEntity } from './permission.orm-entity';
import { RoleOrmEntity } from './role.orm-entity';

/**
 * The boundary that keeps TypeORM out of the domain. Nothing above
 * infrastructure/ ever sees an ORM entity.
 */
export const PermissionMapper = {
  toDomain(row: PermissionOrmEntity): Permission {
    return Permission.fromSnapshot({
      uuid: row.uuid,
      // Rebuilt from the stored name, not from resource/action: the name is the
      // column the unique constraint protects, so it is the one that decides.
      name: PermissionName.of(row.name),
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  },

  toOrm(permission: Permission, internalId?: string): PermissionOrmEntity {
    const row = new PermissionOrmEntity();

    if (internalId !== undefined) {
      row.id = internalId;
    }

    row.uuid = permission.uuid;
    row.name = permission.name.value;
    row.resource = permission.name.resource;
    row.action = permission.name.action;
    row.description = permission.description;
    row.createdAt = permission.createdAt;
    row.updatedAt = permission.updatedAt;

    return row;
  },
};

export const RoleMapper = {
  toDomain(row: RoleOrmEntity, grants: readonly PermissionGrant[]): Role {
    return Role.fromSnapshot({
      uuid: row.uuid,
      name: RoleName.of(row.name),
      description: row.description,
      isProtected: row.isProtected,
      grants,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  },

  toOrm(role: Role, internalId?: string): RoleOrmEntity {
    const row = new RoleOrmEntity();

    if (internalId !== undefined) {
      row.id = internalId;
    }

    row.uuid = role.uuid;
    row.name = role.name.value;
    row.description = role.description;
    row.isProtected = role.isProtected;
    row.createdAt = role.createdAt;
    row.updatedAt = role.updatedAt;

    return row;
  },
};
