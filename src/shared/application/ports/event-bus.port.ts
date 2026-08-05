import { DomainEvent } from '../../domain';

/**
 * The seam between use cases and whatever actually delivers events.
 *
 * Use cases depend on this, never on `@nestjs/cqrs`. When durability is needed,
 * `publishDurable(event, tx)` is added here and the in-process adapter keeps
 * behaving like `publish`; no use case changes. When a context is extracted,
 * the adapter becomes a NATS `ClientProxy` and, again, no use case changes.
 */
export abstract class EventBus {
  abstract publish(event: DomainEvent): Promise<void>;

  abstract publishAll(events: readonly DomainEvent[]): Promise<void>;
}
