import { SdkError } from '../errors/index.js';
import type { ApiResponse } from '@huntara/schema';

export interface HttpClientConfig {
  baseUrl: string;
  token?: string;
  headers?: Record<string, string>;
  tokenResolver?: () => string | null | Promise<string | null>;
  onUnauthorized?: () => void | Promise<void>;
}

export class HttpClient {
  private config: HttpClientConfig;

  constructor(config: HttpClientConfig) {
    this.config = config;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers
    };

    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    } else if (this.config.tokenResolver) {
      const token = await this.config.tokenResolver();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { retries?: number } = {}
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const headers = await this.getHeaders();
    const retries = options.retries ?? 2;

    const requestOptions: RequestInit = {
      method,
      headers
    };
    if (body) {
      requestOptions.body = JSON.stringify(body);
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, requestOptions);

        if (response.status === 401 && this.config.onUnauthorized) {
          await this.config.onUnauthorized();
        }

        const payload = (await response.json()) as ApiResponse<T>;

        if (!response.ok || !payload.success) {
          const retryHeader = response.headers.get('Retry-After');
          const headerRetrySec = retryHeader ? parseInt(retryHeader, 10) : undefined;
          const retryAfterSec =
            (payload.error as any)?.retryAfterSec ??
            (!isNaN(headerRetrySec!) ? headerRetrySec : undefined);
          const nextSendAt = (payload.error as any)?.nextSendAt;
          const reason = (payload.error as any)?.reason;

          throw new SdkError(
            payload.error?.message || response.statusText,
            payload.error?.code,
            response.status,
            payload.error?.details,
            { retryAfterSec, nextSendAt, reason }
          );
        }

        return payload.data as T;
      } catch (error) {
        if (error instanceof SdkError) {
          throw error;
        }
        if (attempt === retries) {
          throw new SdkError(
            error instanceof Error ? error.message : 'Network request failed',
            'NETWORK_ERROR',
            null,
            error
          );
        }
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 200));
      }
    }

    throw new SdkError('Network request failed', 'NETWORK_ERROR');
  }

  public get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  public post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  public put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  public patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  public delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
