import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { Clock, EventBus, UnitOfWork } from '../../../../shared/application';
import { EmailAlreadyRegistered, UserNotFound } from '../../domain/errors';
import { UserRepository } from '../../domain/ports/user-repository.port';
import { User } from '../../domain/user';
import { Email } from '../../domain/value-objects/email';
import { UpdateUserCommand } from './update-user.command';

@CommandHandler(UpdateUserCommand)
export class UpdateUserHandler implements ICommandHandler<UpdateUserCommand, User> {
  constructor(
    private readonly users: UserRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(command: UpdateUserCommand): Promise<User> {
    const user = await this.uow.withTransaction(async () => {
      const found = await this.users.findByUuid(command.uuid);

      if (!found || found.isDeleted) {
        throw UserNotFound();
      }

      const now = this.clock.now();

      if (command.email !== undefined) {
        const email = Email.of(command.email);
        const owner = await this.users.findByEmail(email);

        if (owner && owner.uuid !== found.uuid) {
          throw EmailAlreadyRegistered();
        }

        found.changeEmail(email, now);
      }

      if (command.status !== undefined) {
        found.changeStatus(command.status, now);
      }

      await this.users.save(found);
      return found;
    });

    await this.events.publishAll(user.pullEvents());

    return user;
  }
}
