import { Clock, EventBus, Hasher, UnitOfWork } from '../../../../shared/application';
import { DomainEvent } from '../../../../shared/domain';
import { AppError } from '../../../../shared/errors';
import { Page, PaginationParams } from '../../../../shared/pagination';
import { UserRepository } from '../../domain/ports/user-repository.port';
import { User } from '../../domain/user';
import { Email } from '../../domain/value-objects/email';
import { RegisterUserCommand } from './register-user.command';
import { RegisterUserHandler } from './register-user.handler';

class FakeUserRepository extends UserRepository {
  readonly saved: User[] = [];

  findByUuid(uuid: string): Promise<User | null> {
    return Promise.resolve(this.saved.find((u) => u.uuid === uuid) ?? null);
  }

  findByEmail(email: Email): Promise<User | null> {
    // Mirrors the port contract: live rows only.
    return Promise.resolve(this.saved.find((u) => !u.isDeleted && u.email.equals(email)) ?? null);
  }

  list(params: PaginationParams): Promise<Page<User>> {
    return Promise.resolve(Page.of(this.saved, this.saved.length, params));
  }

  save(user: User): Promise<void> {
    this.saved.push(user);
    return Promise.resolve();
  }
}

class RecordingEventBus extends EventBus {
  readonly published: DomainEvent[] = [];

  publish(event: DomainEvent): Promise<void> {
    this.published.push(event);
    return Promise.resolve();
  }

  publishAll(events: readonly DomainEvent[]): Promise<void> {
    this.published.push(...events);
    return Promise.resolve();
  }
}

class PassThroughUnitOfWork extends UnitOfWork {
  withTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

class FakeHasher extends Hasher {
  hash(plaintext: string): Promise<string> {
    return Promise.resolve(`hashed:${plaintext}`);
  }

  verify(hash: string, plaintext: string): Promise<boolean> {
    return Promise.resolve(hash === `hashed:${plaintext}`);
  }
}

class FixedClock extends Clock {
  now(): Date {
    return new Date('2026-01-01T00:00:00.000Z');
  }
}

function build() {
  const users = new FakeUserRepository();
  const events = new RecordingEventBus();
  // A use case is a plain class — constructed directly, no testing module.
  const handler = new RegisterUserHandler(
    users,
    new FakeHasher(),
    events,
    new PassThroughUnitOfWork(),
    new FixedClock(),
  );

  return { handler, users, events };
}

describe('RegisterUserHandler', () => {
  it('persists a pending user with a hashed password', async () => {
    const { handler, users } = build();

    const user = await handler.execute(new RegisterUserCommand('Ada@Example.com', 'correct-horse'));

    expect(users.saved).toHaveLength(1);
    expect(user.email.value).toBe('ada@example.com');
    expect(user.passwordHash).toBe('hashed:correct-horse');
    expect(user.status).toBe('PENDING');
  });

  it('publishes the registration event after the write', async () => {
    const { handler, events } = build();

    const user = await handler.execute(new RegisterUserCommand('ada@example.com', 'correct-horse'));

    expect(events.published).toMatchObject([
      { name: 'identity.user.registered', userUuid: user.uuid, email: 'ada@example.com' },
    ]);
  });

  it('rejects a duplicate address with a domain error', async () => {
    const { handler } = build();
    await handler.execute(new RegisterUserCommand('ada@example.com', 'correct-horse'));

    await expect(
      handler.execute(new RegisterUserCommand('ADA@example.com', 'another-password')),
    ).rejects.toThrow(AppError);
  });

  it('publishes nothing when registration fails', async () => {
    const { handler, events } = build();
    await handler.execute(new RegisterUserCommand('ada@example.com', 'correct-horse'));
    events.published.length = 0;

    await expect(
      handler.execute(new RegisterUserCommand('ada@example.com', 'another-password')),
    ).rejects.toThrow(AppError);

    expect(events.published).toHaveLength(0);
  });

  it('rejects a malformed address before touching the repository', async () => {
    const { handler, users } = build();

    await expect(handler.execute(new RegisterUserCommand('nope', 'correct-horse'))).rejects.toThrow(
      AppError,
    );
    expect(users.saved).toHaveLength(0);
  });
});
