/**
 * The living definition of what roles and permissions exist.
 *
 * `CreateRbac` seeds the same three permissions and the `admin` role inline.
 * That is not duplication to be removed: a migration is frozen the moment it
 * ships, because editing one that has already run changes nothing on any
 * database that already applied it. The migration is the historical record of
 * how the schema arrived; this file is where the catalogue *grows*, and
 * `pnpm seed` reconciles a database to it.
 *
 * Every permission here is required by a real route. A name nothing enforces
 * would be a promise the application does not keep — holding it would grant
 * nothing, while making the catalogue look like RBAC controls more than it does.
 */
export interface SeedPermission {
  readonly name: string;
  readonly description: string;
}

export interface SeedRole {
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly string[];
  /** Protected roles can gain permissions but never lose one. Only `admin`. */
  readonly isProtected: boolean;
}

export const SEED_PERMISSIONS: readonly SeedPermission[] = [
  { name: 'rbac:admin', description: 'Create roles and permissions, and assign them' },
  { name: 'rbac:read', description: 'Read roles, permissions and assignments' },
  {
    name: 'messaging:admin',
    description: 'Inspect, replay and discard events in the messaging pipeline',
  },
];

/**
 * `auditor` and `messaging-operator` exist to make least privilege the obvious
 * default rather than a thing you have to invent. Reaching for `admin` because
 * no narrower role exists is how every account ends up with everything.
 */
export const SEED_ROLES: readonly SeedRole[] = [
  {
    name: 'admin',
    description: 'Full administrative access',
    permissions: SEED_PERMISSIONS.map((permission) => permission.name),
    isProtected: true,
  },
  {
    name: 'auditor',
    description: 'Read the authorization model without being able to change it',
    permissions: ['rbac:read'],
    isProtected: false,
  },
  {
    name: 'messaging-operator',
    description: 'Work the event pipeline without administering roles',
    permissions: ['messaging:admin'],
    isProtected: false,
  },
];

export const ADMIN_ROLE_NAME = 'admin';
