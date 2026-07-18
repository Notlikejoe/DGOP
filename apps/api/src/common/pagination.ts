/** Standard paged envelope returned when a caller requests pagination. */
export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

/**
 * Parses `page` / `pageSize` query values into safe, bounded numbers.
 * Returns null when no pagination was requested, so list endpoints can stay
 * backwards-compatible (returning a plain array) unless a page is supplied.
 */
export function parsePageParams(
  page?: string | number,
  pageSize?: string | number,
): PageParams | null {
  if (page === undefined || page === null || page === '') return null;
  const p = Math.max(1, Math.floor(Number(page)) || 1);
  const rawSize = Math.floor(Number(pageSize)) || DEFAULT_PAGE_SIZE;
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page: p, pageSize: size, skip: (p - 1) * size, take: size };
}

/** Returns a bounded first-page limit for legacy list endpoints that still return arrays. */
export function boundedFirstPageParams(
  pageSize?: string | number,
  defaultPageSize = MAX_PAGE_SIZE,
): PageParams {
  const rawSize = Math.floor(Number(pageSize)) || defaultPageSize;
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize));
  return { page: 1, pageSize: size, skip: 0, take: size };
}

export function toPaged<T>(data: T[], total: number, params: PageParams): Paged<T> {
  return {
    data,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}
