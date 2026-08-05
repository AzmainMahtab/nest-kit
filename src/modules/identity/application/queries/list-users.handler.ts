import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { Page } from '../../../../shared/pagination';
import { UserRepository } from '../../domain/ports/user-repository.port';
import { User } from '../../domain/user';
import { ListUsersQuery } from './list-users.query';

@QueryHandler(ListUsersQuery)
export class ListUsersHandler implements IQueryHandler<ListUsersQuery, Page<User>> {
  constructor(private readonly users: UserRepository) {}

  execute(query: ListUsersQuery): Promise<Page<User>> {
    return this.users.list(query.pagination);
  }
}
