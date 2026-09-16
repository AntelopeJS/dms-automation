/** Page/limit parameters accepted by the paginated list APIs. */
export interface PageParams {
  page: number;
  limit: number;
}

/** A single page of results returned by the paginated list APIs. */
export interface Paginated<T> extends PageParams {
  results: T[];
  total: number;
}
