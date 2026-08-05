import { uuidv7 } from 'uuidv7';

export abstract class DomainEvent {
  abstract readonly name: string;

  readonly version: string = '1';
  readonly idempotencyKey: string = uuidv7();
  readonly occurredAt: Date = new Date();
}
