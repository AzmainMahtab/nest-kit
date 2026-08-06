import { Grants } from '../../../../shared/application';
import { Page, PaginationParams } from '../../../../shared/pagination';
import { Permission } from '../permission';
import { Role } from '../role';
import { RoleAssignment } from '../role-assignment';
import { PermissionName } from '../value-objects/permission-name';
import { RoleName } from '../value-objects/role-name';

/**
 * One port for the whole context, rather than one per aggregate.
 *
 * Roles, permissions and their two junctions are never queried apart from each
 * other — every operation here starts by resolving a role and a permission
 * together — and splitting them would mean two adapters racing to write the
 * same junction rows inside one transaction. This mirrors `fast-kit`'s and
 * `django-kit`'s RBAC repositories.
 */
export abstract class RbacRepository {
  /** Absence is null, never a throw — the use case decides what it means. */
  abstract findPermissionByName(name: PermissionName): Promise<Permission | null>;

  abstract findPermissionByUuid(uuid: string): Promise<Permission | null>;

  abstract listPermissions(params: PaginationParams): Promise<Page<Permission>>;

  abstract savePermission(permission: Permission): Promise<void>;

  abstract findRoleByName(name: RoleName): Promise<Role | null>;

  abstract findRoleByUuid(uuid: string): Promise<Role | null>;

  abstract listRoles(params: PaginationParams): Promise<Page<Role>>;

  /** Persists the role and reconciles its permission grants in one write. */
  abstract saveRole(role: Role): Promise<void>;

  /** Idempotent: assigning a role the user already holds leaves the original assignment, and its audit row, intact. */
  abstract assignRole(
    userUuid: string,
    role: Role,
    assignedBy: string | null,
    now: Date,
  ): Promise<void>;

  abstract unassignRole(userUuid: string, role: Role): Promise<void>;

  abstract findAssignmentsForUser(userUuid: string): Promise<RoleAssignment[]>;

  /**
   * Every user holding the role. Used to invalidate their cached grants when
   * the role's permissions change.
   */
  abstract findUserUuidsForRole(roleUuid: string): Promise<string[]>;

  /**
   * The authorization hot path: a user's role names and the permission names
   * those roles resolve to, in one query. Kept on the repository rather than
   * composed from the calls above so the adapter can answer it with a single
   * join instead of N round trips per request.
   */
  abstract grantsFor(userUuid: string): Promise<Grants>;
}
