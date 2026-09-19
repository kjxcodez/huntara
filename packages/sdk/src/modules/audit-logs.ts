import { HttpClient } from '../http/client.js';
import type { AuditLog, CreateAuditLogDto } from '@huntara/schema';

export class AuditLogsModule {
  constructor(private client: HttpClient) {}

  public async append(dto: CreateAuditLogDto): Promise<AuditLog> {
    return this.client.post<AuditLog>('/audit-logs', dto);
  }

  public async list(page = 1, limit = 50): Promise<{ data: AuditLog[]; total: number }> {
    return this.client.get<{ data: AuditLog[]; total: number }>(`/audit-logs?page=${page}&limit=${limit}`);
  }

  public async listByEntity(entityType: string, entityId: string, limit = 50): Promise<AuditLog[]> {
    return this.client.get<AuditLog[]>(`/audit-logs/entity/${entityType}/${entityId}?limit=${limit}`);
  }

  public async listByActor(userId: string, limit = 50): Promise<AuditLog[]> {
    return this.client.get<AuditLog[]>(`/audit-logs/actor/${userId}?limit=${limit}`);
  }
}
