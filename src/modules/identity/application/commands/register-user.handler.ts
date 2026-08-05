import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { Clock, EventBus, Hasher, UnitOfWork } from '../../../../shared/application';
import { EmailAlreadyRegistered } from '../../domain/errors';
import { UserRepository } from '../../domain/ports/user-repository.port';
import { User } from '../../domain/user';
import { Email } from '../../domain/value-objects/email';
import { RegisterUserCommand } from './register-user.command';

@CommandHandler(RegisterUserCommand)
export class RegisterUserHandler implements ICommandHandler<RegisterUserCommand, User> {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: Hasher,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(command: RegisterUserCommand): Promise<User> {
    const email = Email.of(command.email);

    // Published inside the transaction: the bus routes the event into the
    // outbox on the same connection, so it commits or rolls back with the user.
    // The UnitOfWork dispatches to in-process handlers only after the commit
    // (AGENTS.md §7).
    return this.uow.withTransaction(async () => {
      // The unique index is the real guard against a concurrent duplicate; this
      // check exists to return a domain error instead of a driver error in the
      // ordinary case.
      if (await this.users.findByEmail(email)) {
        throw EmailAlreadyRegistered();
      }

      const created = User.register(
        email,
        await this.hasher.hash(command.password),
        this.clock.now(),
      );
      await this.users.save(created);
      await this.events.publishAll(created.pullEvents());
      return created;
    });
  }
}
