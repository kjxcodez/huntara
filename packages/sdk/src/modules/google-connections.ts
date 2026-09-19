import { HttpClient } from '../http/client.js';
import type { GoogleConnection } from '@huntara/schema';

export interface ConnectGoogleOptions {
  scopes?: string[];
  prompt?: string;
}

export interface GoogleOAuthStatusResult {
  status: string;
  emailAccountId?: string;
  account?: any;
  error?: string;
}

export class GoogleConnectionsModule {
  constructor(private readonly client: HttpClient) {}

  public async list(): Promise<GoogleConnection[]> {
    return this.client.get<GoogleConnection[]>('/google-connections');
  }

  public async get(id: string): Promise<GoogleConnection> {
    return this.client.get<GoogleConnection>(`/google-connections/${id}`);
  }

  public async connect(
    options?: ConnectGoogleOptions
  ): Promise<{ transactionId: string; authorizationUrl: string }> {
    return this.client.post<{ transactionId: string; authorizationUrl: string }>(
      '/google-connections/connect',
      options || {}
    );
  }

  public async getStatus(transactionId: string): Promise<GoogleOAuthStatusResult> {
    return this.client.get<GoogleOAuthStatusResult>(
      `/google-connections/oauth/status/${transactionId}`
    );
  }

  public async disconnect(id: string): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/google-connections/${id}/disconnect`, {});
  }

  public async reauthorize(
    id: string,
    options?: { scopes?: string[] }
  ): Promise<{ transactionId: string; authorizationUrl: string }> {
    return this.client.post<{ transactionId: string; authorizationUrl: string }>(
      `/google-connections/${id}/reauthorize`,
      options || {}
    );
  }
}
