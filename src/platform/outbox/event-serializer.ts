import { DomainEvent } from '../../shared/domain';

export interface SerializedEvent {
  name: string;
  version: string;
  idempotencyKey: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

const ENVELOPE_KEYS = new Set(['name', 'version', 'idempotencyKey', 'occurredAt']);

/**
 * Splits an event into envelope columns and a JSONB payload. The envelope
 * fields are queryable and indexable; everything else the event carries is
 * opaque to the outbox, which is what lets a new event type ship without a
 * migration.
 */
export function serializeEvent(event: DomainEvent): SerializedEvent {
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(event)) {
    if (!ENVELOPE_KEYS.has(key)) {
      payload[key] = value;
    }
  }

  return {
    name: event.name,
    version: event.version,
    idempotencyKey: event.idempotencyKey,
    occurredAt: event.occurredAt,
    payload,
  };
}

/** The wire format. Consumers dedup on `idempotencyKey`. */
export function toMessage(record: SerializedEvent): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      name: record.name,
      version: record.version,
      idempotencyKey: record.idempotencyKey,
      occurredAt: record.occurredAt.toISOString(),
      payload: record.payload,
    }),
  );
}
