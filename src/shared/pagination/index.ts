export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export class PaginationParams {
  readonly page: number;
  readonly limit: number;

  constructor(page = 1, limit = DEFAULT_PAGE_SIZE) {
    this.page = Math.max(1, Math.trunc(page) || 1);
    this.limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(limit) || DEFAULT_PAGE_SIZE));
  }

  get offset(): number {
    return (this.page - 1) * this.limit;
  }
}

export class Page<T> {
  readonly totalPages: number;

  constructor(
    readonly items: readonly T[],
    readonly total: number,
    readonly page: number,
    readonly limit: number,
  ) {
    this.totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  }

  static of<T>(items: readonly T[], total: number, params: PaginationParams): Page<T> {
    return new Page(items, total, params.page, params.limit);
  }

  map<U>(fn: (item: T) => U): Page<U> {
    return new Page(this.items.map(fn), this.total, this.page, this.limit);
  }
}
