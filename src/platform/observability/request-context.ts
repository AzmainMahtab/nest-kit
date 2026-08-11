import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** Follows one request across every log line it produces. */
  readonly correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * The correlation id, readable from anywhere without threading it through
 * every signature.
 *
 * A logger argument on every use case, repository and handler would be the
 * alternative, and it would put a transport concern into `application/` —
 * exactly what the dependency rule forbids. `AsyncLocalStorage` keeps the id
 * out of the domain while still reaching the log line a use case emits.
 */
export const RequestContextStore = {
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },

  current(): RequestContext | undefined {
    return storage.getStore();
  },

  correlationId(): string | undefined {
    return storage.getStore()?.correlationId;
  },
};
