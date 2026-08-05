/**
 * Revoked access tokens, by `jti`.
 *
 * Access tokens are short-lived and self-contained, so logout cannot "delete"
 * one — the blacklist is what makes revocation take effect before expiry.
 * Entries carry the token's remaining lifetime as a TTL, so the set stays
 * bounded without a sweeper.
 */
export abstract class TokenBlacklist {
  abstract revoke(jti: string, expiresAt: Date): Promise<void>;

  abstract isRevoked(jti: string): Promise<boolean>;
}
