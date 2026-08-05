import { DomainEvent } from '../../../../shared/domain';

export class CarRegistered extends DomainEvent {
  readonly name = 'car.car.registered';

  constructor(
    readonly carUuid: string,
    readonly ownerUuid: string,
    readonly licensePlate: string,
  ) {
    super();
  }
}

export class CarTransferred extends DomainEvent {
  readonly name = 'car.car.transferred';

  constructor(
    readonly carUuid: string,
    readonly fromOwnerUuid: string,
    readonly toOwnerUuid: string,
  ) {
    super();
  }
}

export class CarRepriced extends DomainEvent {
  readonly name = 'car.car.repriced';

  constructor(
    readonly carUuid: string,
    readonly amount: string,
    readonly currency: string,
  ) {
    super();
  }
}

export class CarRetired extends DomainEvent {
  readonly name = 'car.car.retired';

  constructor(
    readonly carUuid: string,
    readonly reason: string,
  ) {
    super();
  }
}
