/**
 * The wire shape the relay publishes. Handlers see this, never a domain class —
 * the producing context may be a separate service by then.
 */
export interface EventMessage {
  name: string;
  version: string;
  idempotencyKey: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

/**
 * A handler driven by the durable JetStream consumer.
 *
 * This is deliberately distinct from `@EventsHandler`, which is in-process and
 * fires right after commit. A given reaction is one or the other, never both —
 * registering the same work twice would double-apply it.
 *
 * Choose durable when the work must survive a crash, may be slow, or belongs to
 * a context you expect to extract. Choose in-process when it must be immediate
 * and losing it on a crash is acceptable.
 *
 * `handle` runs inside a transaction that also records the idempotency marker,
 * so a throw rolls back both and the message is redelivered. Handlers must
 * still tolerate redelivery: delivery is at-least-once.
 */
export abstract class DurableEventHandler {
  /** Stable durable name. Changing it makes NATS replay from the start. */
  abstract readonly consumerName: string;

  /** Event names, without the `evt.` prefix. Wildcards are allowed. */
  abstract readonly subjects: string[];

  abstract handle(event: EventMessage): Promise<void>;
}
