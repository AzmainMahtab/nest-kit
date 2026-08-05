import { Injectable } from '@nestjs/common';

import { Clock, EventBus } from '../../../../shared/application';
import { DurableEventHandler, EventMessage } from '../../../../platform/messaging';
import { CarRepository } from '../../domain/ports/car-repository.port';

/**
 * Second hop of the choreography: identity deletes a user → the owner context
 * deactivates the owner → this retires their cars.
 *
 * The car context never imports owner's internals and never queries identity.
 * It knows only the event name and the shape of its payload.
 */
@Injectable()
export class RetireCarsOnOwnerDeactivated extends DurableEventHandler {
  readonly consumerName = 'car_retire_on_owner_deactivated';
  readonly subjects = ['owner.owner.deactivated'];

  constructor(
    private readonly cars: CarRepository,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {
    super();
  }

  async handle(event: EventMessage): Promise<void> {
    const { ownerUuid, reason } = event.payload as { ownerUuid: string; reason: string };

    const cars = await this.cars.findActiveByOwner(ownerUuid);

    if (cars.length === 0) {
      return;
    }

    const now = this.clock.now();

    for (const car of cars) {
      car.retire(`owner deactivated: ${reason}`, now);
    }

    await this.cars.saveAll(cars);
    await this.events.publishAll(cars.flatMap((car) => car.pullEvents()));
  }
}
