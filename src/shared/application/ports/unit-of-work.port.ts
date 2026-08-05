/**
 * Runs `work` inside a single transaction.
 *
 * Repositories resolve the active transactional context themselves, so `work`
 * receives nothing — a use case never handles a connection, session, or manager.
 * Publish domain events after this resolves, never inside `work`.
 */
export abstract class UnitOfWork {
  abstract withTransaction<T>(work: () => Promise<T>): Promise<T>;
}
