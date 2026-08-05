import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { UserNotFound } from '../../domain/errors';
import { UserRepository } from '../../domain/ports/user-repository.port';
import { User } from '../../domain/user';
import { GetUserQuery } from './get-user.query';

@QueryHandler(GetUserQuery)
export class GetUserHandler implements IQueryHandler<GetUserQuery, User> {
  constructor(private readonly users: UserRepository) {}

  async execute(query: GetUserQuery): Promise<User> {
    const user = await this.users.findByUuid(query.uuid);

    // A soft-deleted user is absent as far as the API is concerned; leaking the
    // difference would let a caller enumerate deleted accounts.
    if (!user || user.isDeleted) {
      throw UserNotFound();
    }

    return user;
  }
}
