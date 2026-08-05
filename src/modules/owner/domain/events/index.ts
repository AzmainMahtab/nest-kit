import { DomainEvent } from '../../../../shared/domain';

export class OwnerRegistered extends DomainEvent {
  readonly name = 'owner.owner.registered';

  constructor(
    readonly ownerUuid: string,
    readonly userUuid: string,
  ) {
    super();
  }
}

export class OwnerAddressChanged extends DomainEvent {
  readonly name = 'owner.owner.address-changed';

  constructor(
    readonly ownerUuid: string,
    readonly address: string,
  ) {
    super();
  }
}

/**
 * The car context reacts to this by retiring the owner's cars. Consumers get
 * `ownerUuid` and nothing else — a subscriber must not need to call back into
 * this context to make sense of the event.
 */
export class OwnerDeactivated extends DomainEvent {
  readonly name = 'owner.owner.deactivated';

  constructor(
    readonly ownerUuid: string,
    readonly reason: string,
  ) {
    super();
  }
}

export class OwnerReactivated extends DomainEvent {
  readonly name = 'owner.owner.reactivated';

  constructor(readonly ownerUuid: string) {
    super();
  }
}
