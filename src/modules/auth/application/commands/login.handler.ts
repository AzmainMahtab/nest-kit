import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { Email, UserRepository, UserStatus } from '../../../identity';
import { Clock, EventBus, Hasher, Tokenizer, UnitOfWork } from '../../../../shared/application';
import { AppError } from '../../../../shared/errors';
import { AccountSuspended, InvalidCredentials } from '../../domain/errors';
import { UserLoggedIn } from '../../domain/events';
import { SessionRepository } from '../../domain/ports/session-repository.port';
import { Session } from '../../domain/session';
import { LoginCommand, TokenPair } from './login.command';

@CommandHandler(LoginCommand)
export class LoginHandler implements ICommandHandler<LoginCommand, TokenPair> {
  constructor(
    // Another context's *port*, taken from its public index. At extraction time
    // this becomes a remote client and the use case is unchanged. Reaching into
    // identity's internals would not survive that (AGENTS.md §13).
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: Hasher,
    private readonly tokenizer: Tokenizer,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(command: LoginCommand): Promise<TokenPair> {
    const user = await this.findUser(command.email);

    // Verify even when the user is missing, against a dummy hash, so the
    // response time does not reveal whether the address exists.
    const matches = user
      ? await this.hasher.verify(user.passwordHash, command.password)
      : await this.hasher.verify(
          '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          command.password,
        );

    if (!user || !matches) {
      throw InvalidCredentials();
    }

    if (user.status === UserStatus.Suspended) {
      throw AccountSuspended();
    }

    const now = this.clock.now();
    const sessionUuid = Session.newUuid();
    const refresh = await this.tokenizer.issueRefresh(user.uuid, sessionUuid);
    const access = await this.tokenizer.issueAccess(user.uuid, sessionUuid);

    await this.uow.withTransaction(async () => {
      const session = Session.start(sessionUuid, user.uuid, refresh.jti, now, refresh.expiresAt);
      await this.sessions.save(session);
      await this.events.publish(new UserLoggedIn(user.uuid, sessionUuid));
    });

    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresAt: access.expiresAt,
    };
  }

  private async findUser(rawEmail: string) {
    try {
      return await this.users.findByEmail(Email.of(rawEmail));
    } catch (error) {
      // A malformed address is a failed login, not a validation error — same
      // reason the credentials error is deliberately vague.
      if (AppError.is(error, 'VALIDATION_FAILED')) {
        return null;
      }
      throw error;
    }
  }
}
