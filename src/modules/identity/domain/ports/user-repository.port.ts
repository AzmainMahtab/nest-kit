import { Page, PaginationParams } from '../../../../shared/pagination';
import { User } from '../user';
import { Email } from '../value-objects/email';

export abstract class UserRepository {
  /** Absence is null, never a throw — the use case decides what it means. */
  abstract findByUuid(uuid: string): Promise<User | null>;

  /**
   * Live users only. Soft-deleted rows are invisible here, matching the partial
   * unique index — otherwise the database would consider an address free while
   * the application considered it taken.
   */
  abstract findByEmail(email: Email): Promise<User | null>;

  abstract list(params: PaginationParams): Promise<Page<User>>;

  abstract save(user: User): Promise<void>;
}
