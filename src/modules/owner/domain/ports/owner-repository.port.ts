import { Page, PaginationParams } from '../../../../shared/pagination';
import { Owner } from '../owner';

export abstract class OwnerRepository {
  abstract findByUuid(uuid: string): Promise<Owner | null>;

  /** One owner per user; this is how the uniqueness rule is checked. */
  abstract findByUserUuid(userUuid: string): Promise<Owner | null>;

  abstract list(params: PaginationParams): Promise<Page<Owner>>;

  abstract save(owner: Owner): Promise<void>;
}
