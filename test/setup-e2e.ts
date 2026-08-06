/**
 * Runs before any test module is imported.
 *
 * This has to be a setup file, not a `process.env` assignment at the top of a
 * spec: `ConfigModule.forRoot()` loads and validates the environment when
 * `app.module.ts` is first imported, and an `import` is evaluated before any
 * statement in the importing file. Overrides written inside a spec are read
 * too late and silently do nothing.
 */

// Drive the relay explicitly with relay.tick() instead of racing its interval.
process.env.OUTBOX_ENABLED = 'false';

// Production backoff is 5 deliveries two seconds apart; exercising that here
// would spend ten seconds asleep. What is under test is the escalation to a
// dead letter, not the wall-clock spacing.
process.env.DURABLE_MAX_DELIVER = '3';
process.env.DURABLE_NAK_DELAY_MS = '150';

// Deliberately longer than any suite takes, so an authorization test that
// passes proves the cache was *invalidated* rather than that it happened to
// expire. A short TTL here would turn a broken invalidation into a green run.
process.env.RBAC_CACHE_TTL_SECONDS = '300';
