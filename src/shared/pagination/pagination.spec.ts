import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page, PaginationParams } from './index';

describe('PaginationParams', () => {
  it('caps limit at MAX_PAGE_SIZE', () => {
    expect(new PaginationParams(1, 5000).limit).toBe(MAX_PAGE_SIZE);
  });

  it('falls back to defaults for junk input', () => {
    expect(new PaginationParams(0, 0).page).toBe(1);
    expect(new PaginationParams(0, 0).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(new PaginationParams(-3, -1).page).toBe(1);
  });

  it('computes offset from page and limit', () => {
    expect(new PaginationParams(3, 20).offset).toBe(40);
  });
});

describe('Page', () => {
  it('derives totalPages', () => {
    expect(new Page([], 45, 1, 20).totalPages).toBe(3);
    expect(new Page([], 0, 1, 20).totalPages).toBe(0);
  });

  it('maps items while preserving the envelope', () => {
    const page = Page.of([1, 2, 3], 3, new PaginationParams(1, 20)).map((n) => n * 2);

    expect(page.items).toEqual([2, 4, 6]);
    expect(page.total).toBe(3);
    expect(page.limit).toBe(20);
  });
});
