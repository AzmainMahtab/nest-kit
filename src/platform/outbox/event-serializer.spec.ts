import { DomainEvent } from '../../shared/domain';
import { serializeEvent, toMessage } from './event-serializer';

class UserRegistered extends DomainEvent {
  readonly name = 'identity.user.registered';

  constructor(
    readonly userUuid: string,
    readonly email: string,
  ) {
    super();
  }
}

describe('event serializer', () => {
  it('splits envelope fields from the payload', () => {
    const record = serializeEvent(new UserRegistered('u-1', 'ada@example.com'));

    expect(record.name).toBe('identity.user.registered');
    expect(record.version).toBe('1');
    expect(record.idempotencyKey).toHaveLength(36);
    expect(record.payload).toEqual({ userUuid: 'u-1', email: 'ada@example.com' });
  });

  it('keeps envelope fields out of the payload so they cannot drift', () => {
    const record = serializeEvent(new UserRegistered('u-1', 'ada@example.com'));

    expect(record.payload).not.toHaveProperty('name');
    expect(record.payload).not.toHaveProperty('idempotencyKey');
    expect(record.payload).not.toHaveProperty('occurredAt');
  });

  it('produces a message carrying the idempotency key for consumer dedup', () => {
    const record = serializeEvent(new UserRegistered('u-1', 'ada@example.com'));
    const decoded = JSON.parse(new TextDecoder().decode(toMessage(record))) as Record<
      string,
      unknown
    >;

    expect(decoded).toMatchObject({
      name: 'identity.user.registered',
      version: '1',
      idempotencyKey: record.idempotencyKey,
      payload: { userUuid: 'u-1', email: 'ada@example.com' },
    });
    expect(typeof decoded.occurredAt).toBe('string');
  });

  it('gives each event instance a distinct idempotency key', () => {
    const a = serializeEvent(new UserRegistered('u-1', 'ada@example.com'));
    const b = serializeEvent(new UserRegistered('u-1', 'ada@example.com'));

    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });
});
