import { ErrorCode } from '@huntara/schema';

export class SdkError extends Error {
  public readonly code: string;
  public readonly details: unknown | null;
  public readonly status: number | null;
  public readonly retryAfterSec?: number | undefined;
  public readonly nextSendAt?: string | undefined;
  public readonly reason?: string | undefined;

  constructor(
    message: string,
    code: string = ErrorCode.INTERNAL_SERVER_ERROR,
    status: number | null = null,
    details: unknown | null = null,
    rateLimitInfo?: {
      retryAfterSec?: number | undefined;
      nextSendAt?: string | undefined;
      reason?: string | undefined;
    }
  ) {
    super(message);
    this.name = 'SdkError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryAfterSec = rateLimitInfo?.retryAfterSec;
    this.nextSendAt = rateLimitInfo?.nextSendAt;
    this.reason = rateLimitInfo?.reason;
    Object.setPrototypeOf(this, SdkError.prototype);
  }
}

export function isSdkError(error: unknown): error is SdkError {
  return error instanceof SdkError;
}
