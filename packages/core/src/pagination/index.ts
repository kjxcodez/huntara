import type { PaginationParams, SortOrder, PaginationMeta } from '@huntara/schema';
import { LIMITS } from '../constants/index.js';

export function getPaginationParams(query: Record<string, any>): Required<PaginationParams> {
  const page = Math.max(1, parseInt(query.page as string, 10) || 1);
  const limit = Math.min(
    LIMITS.PAGINATION.MAX_LIMIT,
    Math.max(1, parseInt(query.limit as string, 10) || LIMITS.PAGINATION.DEFAULT_LIMIT)
  );
  const sortBy = (query.sortBy as string) || 'createdAt';
  const sortOrder: SortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

  return { page, limit, sortBy, sortOrder };
}

export function buildPaginatedMeta(total: number, page: number, limit: number): PaginationMeta {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1
  };
}
