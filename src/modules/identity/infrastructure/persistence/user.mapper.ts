import { User } from '../../domain/user';
import { UserStatus, isUserStatus } from '../../domain/user-status';
import { Email } from '../../domain/value-objects/email';
import { UserOrmEntity } from './user.orm-entity';

/**
 * The boundary that keeps TypeORM out of the domain. Nothing above
 * infrastructure/ ever sees a UserOrmEntity.
 */
export const UserMapper = {
  toDomain(row: UserOrmEntity): User {
    return User.fromSnapshot({
      uuid: row.uuid,
      email: Email.of(row.email),
      passwordHash: row.passwordHash,
      // A row written by an older deploy, or by hand, can carry a status this
      // build does not know. Failing loudly beats silently treating it as active.
      status: isUserStatus(row.status) ? row.status : UserStatus.Suspended,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  },

  toOrm(user: User, internalId?: string): UserOrmEntity {
    const row = new UserOrmEntity();

    if (internalId !== undefined) {
      row.id = internalId;
    }

    row.uuid = user.uuid;
    row.email = user.email.value;
    row.passwordHash = user.passwordHash;
    row.status = user.status;
    row.createdAt = user.createdAt;
    row.updatedAt = user.updatedAt;
    row.deletedAt = user.deletedAt;

    return row;
  },
};
