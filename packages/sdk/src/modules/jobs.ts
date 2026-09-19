import { HttpClient } from '../http/client.js';
import { toQueryString } from '../utils/query.js';
import type {
  Job,
  CreateJobDto,
  BulkJobDto,
  JobCheckpointDto,
  JobStatusTransitionDto,
  BulkOperationResult
} from '@huntara/schema';

export class JobsModule {
  constructor(private client: HttpClient) {}

  public async list(params?: {
    page?: number;
    limit?: number;
    status?: string;
    type?: string;
    workerId?: string;
  }): Promise<{ data: Job[]; total: number }> {
    const queryParams = toQueryString(params);
    return this.client.get<{ data: Job[]; total: number }>(`/jobs${queryParams}`);
  }

  public async get(id: string): Promise<Job> {
    return this.client.get<Job>(`/jobs/${id}`);
  }

  public async create(dto: CreateJobDto): Promise<Job> {
    return this.client.post<Job>('/jobs', dto);
  }

  public async createBulk(dto: BulkJobDto): Promise<BulkOperationResult<Job>> {
    return this.client.post<BulkOperationResult<Job>>('/jobs/bulk', dto);
  }

  public async claim(
    paramOrTypes: { workerId?: string; supportedTypes?: string[]; leaseDurationMs?: number } | string[],
    workerId?: string,
    leaseDurationMs?: number
  ): Promise<Job | null> {
    const payload = Array.isArray(paramOrTypes)
      ? {
          supportedTypes: paramOrTypes,
          workerId: workerId || 'default-worker',
          leaseDurationMs: leaseDurationMs || 60_000
        }
      : {
          supportedTypes: paramOrTypes.supportedTypes || [],
          workerId: paramOrTypes.workerId || 'default-worker',
          leaseDurationMs: paramOrTypes.leaseDurationMs || 60_000
        };
    return this.client.post<Job | null>('/jobs/claim', payload);
  }

  public async checkpoint(id: string, dto: JobCheckpointDto): Promise<Job> {
    return this.client.post<Job>(`/jobs/${id}/checkpoint`, dto);
  }

  public async heartbeat(id: string, workerId?: string, leaseDurationMs?: number): Promise<Job> {
    return this.client.post<Job>(`/jobs/${id}/heartbeat`, { workerId, leaseDurationMs });
  }

  public async updateStatus(id: string, dto: JobStatusTransitionDto): Promise<Job> {
    return this.client.post<Job>(`/jobs/${id}/status`, dto);
  }

  public async complete(id: string, workerId?: string, durationMs?: number): Promise<Job> {
    return this.client.post<Job>(`/jobs/${id}/complete`, { workerId, durationMs });
  }

  public async fail(id: string, error: string, workerId?: string, durationMs?: number): Promise<Job> {
    return this.client.post<Job>(`/jobs/${id}/fail`, { error, workerId, durationMs });
  }

  public async cancel(id: string): Promise<Job> {
    return this.client.post<Job>(`/jobs/${id}/cancel`, {});
  }

  public async recover(staleThresholdMs?: number): Promise<{ recovered: number; failed: number }> {
    return this.client.post<{ recovered: number; failed: number }>('/jobs/recover', { staleThresholdMs });
  }

  public async listDeadLetters(params?: { limit?: number | undefined; offset?: number | undefined }): Promise<{ items: Job[]; total: number }> {
    const queryParams = toQueryString(params);
    return this.client.get<{ items: Job[]; total: number }>(`/jobs/dead-letters${queryParams}`);
  }

  public async moveToDeadLetter(
    id: string,
    reason: string,
    lineage?: Record<string, any>
  ): Promise<Job> {
    return this.client.post<Job>(`/jobs/${id}/dead-letter`, { reason, lineage });
  }

  public async requeueDeadLetter(id: string): Promise<Job> {
    return this.client.post<Job>(`/jobs/${id}/requeue`, {});
  }
}
