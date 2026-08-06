/**
 * The rbac context's entire public surface. Another context may import from
 * here and nowhere else inside this folder (AGENTS.md §13), which is enforced by
 * `pnpm check:arch`.
 *
 * `AccessControl` in `shared/application` is what the guard and every ordinary
 * consumer use — authorization is a question anything may ask. `RbacRepository`
 * is here for the one caller that legitimately administers the model rather
 * than querying it: the seed, which is a composition-root concern and reaches
 * into contexts by design.
 */
export { RbacModule } from './rbac.module';
export { RbacRepository } from './domain/ports/rbac-repository.port';
export { Permission } from './domain/permission';
export { Role } from './domain/role';
export type { PermissionGrant } from './domain/role';
export type { RoleAssignment } from './domain/role-assignment';
export { PermissionName } from './domain/value-objects/permission-name';
export { RoleName } from './domain/value-objects/role-name';
export {
  PermissionCreated,
  RoleAssignedToUser,
  RoleCreated,
  RolePermissionGranted,
  RolePermissionRevoked,
  RoleUnassignedFromUser,
} from './domain/events';
