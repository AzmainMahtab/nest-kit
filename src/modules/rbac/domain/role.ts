import { uuidv7 } from 'uuidv7';

import { DomainEvent } from '../../../shared/domain';
import { RoleIsProtected } from './errors';
import { RoleCreated, RolePermissionGranted, RolePermissionRevoked } from './events';
import { Permission } from './permission';
import { PermissionName } from './value-objects/permission-name';
import { RoleName } from './value-objects/role-name';

/**
 * A permission held by a role, with the audit trail of who granted it. Kept as
 * a record rather than a bare `Permission` because "who gave this role the
 * ability to delete users, and when" is the first question asked after an
 * incident, and it cannot be reconstructed later.
 */
export interface PermissionGrant {
  readonly permission: Permission;
  readonly grantedBy: string | null;
  readonly grantedAt: Date;
}

export interface RoleSnapshot {
  uuid: string;
  name: RoleName;
  description: string;
  isProtected: boolean;
  grants: readonly PermissionGrant[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The aggregate root for a named bundle of permissions.
 *
 * Its permission grants are inside the boundary — they are small, bounded by
 * the size of the permission catalogue, and never edited independently of the
 * role. The users holding a role are deliberately *outside* it: that set is
 * unbounded, so it lives in its own table and its own repository methods
 * (AGENTS.md §3).
 */
export class Role {
  private readonly events: DomainEvent[] = [];
  private readonly _grants: PermissionGrant[];

  private constructor(
    readonly uuid: string,
    readonly name: RoleName,
    private _description: string,
    readonly isProtected: boolean,
    grants: readonly PermissionGrant[],
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {
    this._grants = [...grants];
  }

  static create(name: RoleName, description: string, now: Date): Role {
    const role = new Role(uuidv7(), name, description, false, [], now, now);
    role.record(new RoleCreated(role.uuid, name.value));
    return role;
  }

  /** Rehydration from persistence. Records no events. */
  static fromSnapshot(snapshot: RoleSnapshot): Role {
    return new Role(
      snapshot.uuid,
      snapshot.name,
      snapshot.description,
      snapshot.isProtected,
      snapshot.grants,
      snapshot.createdAt,
      snapshot.updatedAt,
    );
  }

  get description(): string {
    return this._description;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get grants(): readonly PermissionGrant[] {
    return this._grants;
  }

  get permissionNames(): readonly string[] {
    return this._grants.map((grant) => grant.permission.name.value);
  }

  holds(name: PermissionName): boolean {
    return this._grants.some((grant) => grant.permission.name.equals(name));
  }

  /**
   * Idempotent: granting a permission the role already holds is a no-op rather
   * than an error, so a re-run of a provisioning script does not fail halfway.
   */
  grant(permission: Permission, grantedBy: string | null, now: Date): void {
    this.assertNotProtected();

    if (this.holds(permission.name)) {
      return;
    }

    this._grants.push({ permission, grantedBy, grantedAt: now });
    this.touch(now);
    this.record(new RolePermissionGranted(this.uuid, permission.name.value));
  }

  /** Idempotent in the same way: revoking what is not held changes nothing. */
  revoke(name: PermissionName, now: Date): void {
    this.assertNotProtected();

    const index = this._grants.findIndex((grant) => grant.permission.name.equals(name));

    if (index === -1) {
      return;
    }

    this._grants.splice(index, 1);
    this.touch(now);
    this.record(new RolePermissionRevoked(this.uuid, name.value));
  }

  describe(description: string, now: Date): void {
    if (this._description === description) {
      return;
    }

    this._description = description;
    this.touch(now);
  }

  pullEvents(): DomainEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /**
   * The seeded `admin` role is frozen. It is the role that holds `rbac:admin`,
   * so an administrator who revokes that permission from it locks every
   * administrator out of the only endpoint that could grant it back — a state
   * recoverable only by hand-written SQL. Curate a new role instead.
   */
  private assertNotProtected(): void {
    if (this.isProtected) {
      throw RoleIsProtected(this.name.value);
    }
  }

  private touch(now: Date): void {
    this._updatedAt = now;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
