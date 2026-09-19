import { HttpClient } from '../http/client.js';
import { toQueryString } from '../utils/query.js';
import type {
  SystemLog,
  CreateSystemLogDto,
  BulkSystemLogDto,
  BulkOperationResult
} from '@huntara/schema';

export class SystemLogsModule {
  constructor(private client: HttpClient) {}

  public async append(dto: CreateSystemLogDto): Promise<SystemLog> {
    return this.client.post<SystemLog>('/system-logs', dto);
  }

  public async createBulk(dto: BulkSystemLogDto): Promise<BulkOperationResult<SystemLog>> {
    return this.client.post<BulkOperationResult<SystemLog>>('/system-logs/bulk', dto);
  }

  public async listRecent(limit = 100, severity?: string): Promise<SystemLog[]> {
    const query = toQueryString({ limit, severity });
    return this.client.get<SystemLog[]>(`/system-logs${query}`);
  }
}
