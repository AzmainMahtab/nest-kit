/**
 * What a caller is allowed to do, as every context sees it.
 *
 * Declared in `shared/` because two unrelated consumers need it: the HTTP
 * authorization guard in `platform/`, and any use case that has to make an
 * authorization decision it cannot express as a route rule. The `rbac` context
 * is the only implementor; nothing else may reach into its internals.
 *
 * Both lists are flat name strings rather than domain entities on purpose. The
 * guard compares strings, and returning `Role`/`Permission` here would drag the
 * rbac domain into `platform/` and into every other context.
 */
export interface Grants {
  /** Role names held by the user, e.g. `admin`. */
  readonly roles: readonly string[];
  /** Permission names the roles resolve to, e.g. `messaging:admin`. */
  readonly permissions: readonly string[];
}

export const NO_GRANTS: Grants = { roles: [], permissions: [] };

export abstract class AccessControl {
  /**
   * Everything the user is granted, resolved through their roles.
   *
   * A user with no roles gets empty lists, never a throw — "not authorized" is
   * the guard's decision to make, not the lookup's.
   */
  abstract grantsFor(userUuid: string): Promise<Grants>;
}
