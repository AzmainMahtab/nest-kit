export abstract class Hasher {
  abstract hash(plaintext: string): Promise<string>;

  /**
   * Constant-time comparison. Returns false rather than throwing on a malformed
   * stored hash, so a corrupted row cannot be distinguished from a wrong password.
   */
  abstract verify(hash: string, plaintext: string): Promise<boolean>;
}
