import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { Page, PaginationParams } from '../../../../shared/pagination';
import { OwnerNotFound } from '../../domain/errors';
import { Owner } from '../../domain/owner';
import { OwnerRepository } from '../../domain/ports/owner-repository.port';

export class GetOwnerQuery {
  constructor(readonly uuid: string) {}
}

export class ListOwnersQuery {
  constructor(readonly pagination: PaginationParams) {}
}

@QueryHandler(GetOwnerQuery)
export class GetOwnerHandler implements IQueryHandler<GetOwnerQuery, Owner> {
  constructor(private readonly owners: OwnerRepository) {}

  async execute(query: GetOwnerQuery): Promise<Owner> {
    const owner = await this.owners.findByUuid(query.uuid);

    if (!owner) {
      throw OwnerNotFound();
    }

    return owner;
  }
}

@QueryHandler(ListOwnersQuery)
export class ListOwnersHandler implements IQueryHandler<ListOwnersQuery, Page<Owner>> {
  constructor(private readonly owners: OwnerRepository) {}

  execute(query: ListOwnersQuery): Promise<Page<Owner>> {
    return this.owners.list(query.pagination);
  }
}
