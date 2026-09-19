import { HttpClient } from '../http/client.js';
import { toQueryString } from '../utils/query.js';
import type {
  OperationRecord,
  OperationsHealthSummary,
  OperationTimelineEvent,
  OperationsQueryDto,
  RetryOperationDto
} from '@huntara/schema';

export class OperationsModule {
  constructor(private client: HttpClient) {}

  public async list(params?: OperationsQueryDto): Promise<{
    items: OperationRecord[];
    total: number;
    page: number;
    limit: number;
  }> {
    const queryParams = toQueryString(params);
    return this.client.get<{
      items: OperationRecord[];
      total: number;
      page: number;
      limit: number;
    }>(`/operations${queryParams}`);
  }

  public async get(id: string): Promise<OperationRecord> {
    return this.client.get<OperationRecord>(`/operations/${id}`);
  }

  public async getEvents(id: string): Promise<OperationTimelineEvent[]> {
    return this.client.get<OperationTimelineEvent[]>(`/operations/${id}/events`);
  }

  public async retry(
    id: string,
    dto?: RetryOperationDto
  ): Promise<{
    success: boolean;
    message: string;
    operation: OperationRecord;
  }> {
    return this.client.post<{
      success: boolean;
      message: string;
      operation: OperationRecord;
    }>(`/operations/${id}/retry`, dto || {});
  }

  public async reconcile(id: string): Promise<{
    success: boolean;
    message: string;
    result: any;
  }> {
    return this.client.post<{
      success: boolean;
      message: string;
      result: any;
    }>(`/operations/${id}/reconcile`, {});
  }

  public async getHealth(): Promise<OperationsHealthSummary> {
    return this.client.get<OperationsHealthSummary>('/operations/health');
  }
}
