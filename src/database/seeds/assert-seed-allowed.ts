const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'db']);

export interface SeedTarget {
  /** The database host the seed would write to. */
  host: string;
  /** `ALLOW_REMOTE_SEED` — a deliberate, eyes-open override. */
  allowRemote: boolean;
}

/**
 * Refuses to seed a database that is not obviously local.
 *
 * The failure this exists to prevent: a developer points `.env` at the shared
 * dev or staging database — through a tunnel, so the host looks harmless — and
 * then runs `make seed` out of habit. The rbac seed is additive and survives
 * that, but the superadmin seed would create an administrator account with a
 * password from a local `.env` file on a shared system, and nothing would
 * report it.
 *
 * Deliberately a host allowlist rather than a `NODE_ENV` check: `NODE_ENV` is
 * whatever the shell last exported, while the host is the thing actually being
 * written to.
 */
export function assertSeedAllowed({ host, allowRemote }: SeedTarget): void {
  if (LOCAL_HOSTS.has(host) || allowRemote) {
    return;
  }

  throw new Error(
    [
      `Refusing to seed the non-local database host '${host}'.`,
      '',
      'Seeding creates an administrator account from local configuration.',
      'If this really is the intended target, re-run with ALLOW_REMOTE_SEED=true.',
    ].join('\n'),
  );
}
