import { PaginationParams } from '../../../../shared/pagination';

export class ListUsersQuery {
  constructor(readonly pagination: PaginationParams) {}
}
