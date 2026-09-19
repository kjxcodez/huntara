import { HttpClient } from '../http/client.js';
import type { WorkspaceMemory } from '@huntara/schema';

export class WorkspaceMemoryModule {
  constructor(private client: HttpClient) {}

  public async get(scope: string, key: string): Promise<WorkspaceMemory | null> {
    return this.client.get<WorkspaceMemory | null>(`/workspace-memory/${scope}/${key}`);
  }

  public async set(scope: string, key: string, value: any): Promise<WorkspaceMemory> {
    return this.client.post<WorkspaceMemory>(`/workspace-memory/${scope}/${key}`, { value });
  }

  public async delete(scope: string, key: string): Promise<{ deleted: boolean }> {
    return this.client.delete<{ deleted: boolean }>(`/workspace-memory/${scope}/${key}`);
  }

  public async list(scope: string): Promise<WorkspaceMemory[]> {
    return this.client.get<WorkspaceMemory[]>(`/workspace-memory/${scope}`);
  }
}
