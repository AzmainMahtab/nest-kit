import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { Clock, EventBus, UnitOfWork } from '../../../../shared/application';
import { UserNotFound } from '../../domain/errors';
import { UserRepository } from '../../domain/ports/user-repository.port';
import { DeleteUserCommand } from './delete-user.command';

@CommandHandler(DeleteUserCommand)
export class DeleteUserHandler implements ICommandHandler<DeleteUserCommand, void> {
  constructor(
    private readonly users: UserRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(command: DeleteUserCommand): Promise<void> {
    await this.uow.withTransaction(async () => {
      const found = await this.users.findByUuid(command.uuid);

      if (!found || found.isDeleted) {
        throw UserNotFound();
      }

      found.delete(this.clock.now());
      await this.users.save(found);
      await this.events.publishAll(found.pullEvents());
    });
  }
}
