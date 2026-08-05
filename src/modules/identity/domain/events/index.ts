import { DomainEvent } from '../../../../shared/domain';

export class UserRegistered extends DomainEvent {
  readonly name = 'identity.user.registered';

  constructor(
    readonly userUuid: string,
    readonly email: string,
  ) {
    super();
  }
}

export class UserEmailChanged extends DomainEvent {
  readonly name = 'identity.user.email-changed';

  constructor(
    readonly userUuid: string,
    readonly oldEmail: string,
    readonly newEmail: string,
  ) {
    super();
  }
}

export class UserStatusChanged extends DomainEvent {
  readonly name = 'identity.user.status-changed';

  constructor(
    readonly userUuid: string,
    readonly oldStatus: string,
    readonly newStatus: string,
  ) {
    super();
  }
}

export class UserDeleted extends DomainEvent {
  readonly name = 'identity.user.deleted';

  constructor(readonly userUuid: string) {
    super();
  }
}
