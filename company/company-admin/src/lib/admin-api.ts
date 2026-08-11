import { serverGetPaginated, serverGetOptional } from './server-api';

export interface ListQuery {
  page?: string | number;
  pageSize?: string | number;
  search?: string;
  status?: string;
  sort?: string;
  order?: string;
  range?: string;
  from?: string;
  to?: string;
}

const EMPTY_META = { page: 1, pageSize: 20, total: 0, totalPages: 0 };

export interface ListResult<T> {
  data: T[];
  meta: typeof EMPTY_META;
  /**
   * True when the API could not be reached. Pages must surface this — an empty
   * table and an unreachable backend look identical otherwise.
   */
  unavailable: boolean;
}

export async function listOrEmpty<T>(path: string, query: ListQuery = {}): Promise<ListResult<T>> {
  const cleaned: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') cleaned[key] = value as string | number;
  }

  try {
    const result = await serverGetPaginated<T>(path, cleaned);
    return { data: result.data, meta: result.meta, unavailable: false };
  } catch {
    return { data: [] as T[], meta: EMPTY_META, unavailable: true };
  }
}

export { serverGetOptional };
