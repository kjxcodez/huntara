import type {
  SuccessResponse,
  ApiErrorResponse,
  PaginatedResponse,
  PaginationMeta
} from '@huntara/schema';
import { ErrorCode } from '@huntara/schema';

export function successResponse<T>(data: T, meta?: Record<string, unknown>): SuccessResponse<T> {
  const result: SuccessResponse<T> = {
    success: true,
    data,
    error: null
  };
  if (meta) {
    result.meta = meta;
  }
  return result;
}

export function errorResponse(
  message: string,
  code: ErrorCode | string = ErrorCode.INTERNAL_SERVER_ERROR,
  details: unknown | null = null,
  rateLimitInfo?: {
    retryAfterSec?: number;
    nextSendAt?: string;
    reason?: string;
  }
): ApiErrorResponse {
  return {
    success: false,
    data: null,
    error: {
      code: code as ErrorCode,
      message,
      details,
      ...(rateLimitInfo?.retryAfterSec !== undefined ? { retryAfterSec: rateLimitInfo.retryAfterSec } : {}),
      ...(rateLimitInfo?.nextSendAt !== undefined ? { nextSendAt: rateLimitInfo.nextSendAt } : {}),
      ...(rateLimitInfo?.reason !== undefined ? { reason: rateLimitInfo.reason } : {})
    }
  };
}

export function paginatedResponse<T>(data: T[], meta: PaginationMeta): PaginatedResponse<T> {
  return {
    success: true,
    data,
    error: null,
    meta: {
      pagination: meta
    }
  };
}
