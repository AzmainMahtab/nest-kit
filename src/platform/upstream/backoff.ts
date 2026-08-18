/**
 * Exponential backoff with full jitter.
 *
 * The jitter is not decoration. Without it, every caller that failed in the
 * same second retries in the same second, and a service that is struggling is
 * hit by a synchronised wave exactly when it is least able to take one.
 */
export function backoffDelayMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number,
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}
