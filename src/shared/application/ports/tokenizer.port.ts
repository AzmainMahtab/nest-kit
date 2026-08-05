export type TokenType = 'access' | 'refresh';

export interface TokenClaims {
  /** Subject: the user's public uuid. */
  sub: string;
  /** Unique token id, used for blacklisting and rotation detection. */
  jti: string;
  /** The session this token belongs to. */
  sid: string;
  typ: TokenType;
  /** Expiry, seconds since the epoch. Bounds the blacklist entry on logout. */
  exp: number;
}

export interface IssuedToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

/**
 * Lives in shared because both the auth context (which mints) and the platform
 * guard (which verifies on every request) need it.
 */
export abstract class Tokenizer {
  abstract issueAccess(sub: string, sid: string): Promise<IssuedToken>;

  abstract issueRefresh(sub: string, sid: string): Promise<IssuedToken>;

  /** Rejects anything that is not a valid ES256 token with `typ: 'access'`. */
  abstract parseAccess(token: string): Promise<TokenClaims>;

  /** Rejects anything that is not a valid ES256 token with `typ: 'refresh'`. */
  abstract parseRefresh(token: string): Promise<TokenClaims>;
}
