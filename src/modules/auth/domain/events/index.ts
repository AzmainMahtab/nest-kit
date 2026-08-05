import { DomainEvent } from '../../../../shared/domain';

export class UserLoggedIn extends DomainEvent {
  readonly name = 'auth.user.logged-in';

  constructor(
    readonly userUuid: string,
    readonly sessionUuid: string,
  ) {
    super();
  }
}

export class UserLoggedOut extends DomainEvent {
  readonly name = 'auth.user.logged-out';

  constructor(
    readonly userUuid: string,
    readonly sessionUuid: string,
  ) {
    super();
  }
}

export class SessionRevoked extends DomainEvent {
  readonly name = 'auth.session.revoked';

  constructor(
    readonly sessionUuid: string,
    readonly userUuid: string,
  ) {
    super();
  }
}
