/**
 * Work that runs on a timer rather than in response to a request.
 *
 * Extend it, register the subclass as a provider anywhere, and the scheduler
 * finds it — the same discovery the durable consumers use, for the same
 * reason: a central list of tasks is a file every feature branch edits and
 * therefore a file every merge conflicts on.
 *
 * `run` is executed on **one replica at a time**. Nothing in a subclass has to
 * know that, which is the point — a task that must reason about how many
 * copies of itself are running has already been written twice.
 */
export abstract class ScheduledTask {
  /** Stable and unique: it is the lock key, so renaming it re-runs the task everywhere at once. */
  abstract readonly name: string;

  abstract readonly intervalMs: number;

  abstract run(): Promise<void>;
}
