import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { UserRepository } from '../../../identity';
import { Clock, EventBus, UnitOfWork } from '../../../../shared/application';
import { AppError } from '../../../../shared/errors';
import { OwnerAlreadyRegistered } from '../../domain/errors';
import { Owner } from '../../domain/owner';
import { OwnerRepository } from '../../domain/ports/owner-repository.port';
import { DateOfBirth } from '../../domain/value-objects/date-of-birth';
import { RegisterOwnerCommand } from './register-owner.command';

@CommandHandler(RegisterOwnerCommand)
export class RegisterOwnerHandler implements ICommandHandler<RegisterOwnerCommand, Owner> {
  constructor(
    private readonly owners: OwnerRepository,
    // Another context's port, from its public index. Never its internals.
    private readonly users: UserRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(command: RegisterOwnerCommand): Promise<Owner> {
    const now = this.clock.now();
    const dateOfBirth = DateOfBirth.of(command.dateOfBirth, now);

    return this.uow.withTransaction(async () => {
      // Referential integrity across contexts is checked here, not by a foreign
      // key. A FK would tie the two schemas together and have to be dropped
      // before either could be extracted.
      const user = await this.users.findByUuid(command.userUuid);

      if (!user || user.isDeleted) {
        throw AppError.invalid('USER_NOT_FOUND', 'no such user').withField(
          'userUuid',
          'does not exist',
        );
      }

      if (await this.owners.findByUserUuid(command.userUuid)) {
        throw OwnerAlreadyRegistered();
      }

      const owner = Owner.register(command.userUuid, command.address, dateOfBirth, now);
      await this.owners.save(owner);
      await this.events.publishAll(owner.pullEvents());

      return owner;
    });
  }
}
