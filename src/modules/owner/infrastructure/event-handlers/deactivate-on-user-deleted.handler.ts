import { Injectable } from '@nestjs/common';

import { Clock, EventBus } from '../../../../shared/application';
import { DurableEventHandler, EventMessage } from '../../../../platform/messaging';
import { OwnerRepository } from '../../domain/ports/owner-repository.port';

/**
 * First hop of a two-step choreography:
 *
 *   identity.user.deleted → owner deactivated → car retired
 *
 * The owner context does not import identity, and the car context does not
 * import owner. Each reacts to a published event, which is what lets any of the
 * three be extracted without the others noticing.
 */
@Injectable()
export class DeactivateOwnerOnUserDeleted extends DurableEventHandler {
  readonly consumerName = 'owner_deactivate_on_user_deleted';
  readonly subjects = ['identity.user.deleted'];

  constructor(
    private readonly owners: OwnerRepository,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {
    super();
  }

  async handle(event: EventMessage): Promise<void> {
    const { userUuid } = event.payload as { userUuid: string };
    const owner = await this.owners.findByUserUuid(userUuid);

    // Most users are not owners. A no-op is a success, not a failure — throwing
    // here would retry until the message dead-letters.
    if (!owner) {
      return;
    }

    owner.deactivate('user deleted', this.clock.now());
    await this.owners.save(owner);

    // Published inside the consumer's transaction, so the outbox row commits
    // with the deactivation and the next hop cannot be lost.
    await this.events.publishAll(owner.pullEvents());
  }
}
