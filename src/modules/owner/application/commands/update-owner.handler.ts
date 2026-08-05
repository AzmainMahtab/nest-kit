import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { Clock, EventBus, UnitOfWork } from '../../../../shared/application';
import { OwnerNotFound } from '../../domain/errors';
import { Owner } from '../../domain/owner';
import { OwnerRepository } from '../../domain/ports/owner-repository.port';
import { DeactivateOwnerCommand, UpdateOwnerAddressCommand } from './update-owner.command';

@CommandHandler(UpdateOwnerAddressCommand)
export class UpdateOwnerAddressHandler implements ICommandHandler<
  UpdateOwnerAddressCommand,
  Owner
> {
  constructor(
    private readonly owners: OwnerRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  execute(command: UpdateOwnerAddressCommand): Promise<Owner> {
    return this.uow.withTransaction(async () => {
      const owner = await this.owners.findByUuid(command.uuid);

      if (!owner) {
        throw OwnerNotFound();
      }

      owner.changeAddress(command.address, this.clock.now());
      await this.owners.save(owner);
      await this.events.publishAll(owner.pullEvents());

      return owner;
    });
  }
}

@CommandHandler(DeactivateOwnerCommand)
export class DeactivateOwnerHandler implements ICommandHandler<DeactivateOwnerCommand, Owner> {
  constructor(
    private readonly owners: OwnerRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  execute(command: DeactivateOwnerCommand): Promise<Owner> {
    return this.uow.withTransaction(async () => {
      const owner = await this.owners.findByUuid(command.uuid);

      if (!owner) {
        throw OwnerNotFound();
      }

      // Deactivation is idempotent in the aggregate, so a redelivered event
      // emits nothing the second time and the car context is not re-triggered.
      owner.deactivate(command.reason, this.clock.now());
      await this.owners.save(owner);
      await this.events.publishAll(owner.pullEvents());

      return owner;
    });
  }
}
