/**
 * The rbac context's entire public surface. Another context may import from
 * here and nowhere else inside this folder (AGENTS.md §13), which is enforced by
 * `pnpm check:arch`.
 *
 * Note what is *not* here: `RbacRepository` is exported by the module for DI,
 * but the guard and every other consumer go through the `AccessControl` port in
 * `shared/application` instead. Authorization is a question anything may ask;
 * editing roles is not.
 */
export { RbacModule } from './rbac.module';
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
