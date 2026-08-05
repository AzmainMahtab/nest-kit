/**
 * The caller's identity, as every context sees it.
 *
 * Only the type lives here — `shared/` is framework-free, so the `@CurrentUser()`
 * parameter decorator lives in `platform/http/decorators/`. Any context may
 * import this; none may import `modules/auth/presentation`, which would create
 * a cycle and block extraction (AGENTS.md §6).
 */
export interface CurrentUser {
  /** The user's public uuid. */
  uuid: string;
  /** The session this request was authenticated against. */
  sessionUuid: string;
  /** The access token's id, so a handler can revoke the caller's own token. */
  jti: string;
  /** When that token expires, so a blacklist entry can be bounded by it. */
  expiresAt: Date;
}

export const CURRENT_USER_KEY = 'currentUser';
