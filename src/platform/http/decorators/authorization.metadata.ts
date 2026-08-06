/**
 * Metadata keys shared by the `@RequireRoles()` / `@RequirePermissions()`
 * decorators and the guard that reads them.
 *
 * They live in their own file so the decorators can reference the guard class
 * without the guard having to import the decorators back — a cycle Nest
 * resolves to `undefined` at decoration time, which fails as a route with no
 * guard at all rather than as an error.
 */
export const REQUIRED_ROLES_KEY = 'requiredRoles';
export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';
