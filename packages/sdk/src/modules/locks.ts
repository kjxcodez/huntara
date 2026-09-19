import { HttpClient } from '../http/client.js';
import type {
  AcquireLockDto,
  ReleaseLockDto,
  LockResponse
} from '@huntara/schema';

export class LocksModule {
  constructor(private client: HttpClient) {}

  public async acquire(dto: AcquireLockDto): Promise<LockResponse> {
    try {
      return await this.client.post<LockResponse>('/automation-locks/acquire', dto);
    } catch (err: any) {
      if (err?.status === 409) {
        return { acquired: false, lockKey: '' };
      }
      throw err;
    }
  }

  public async renew(dto: AcquireLockDto): Promise<{ renewed: boolean }> {
    return this.client.post<{ renewed: boolean }>('/automation-locks/renew', dto);
  }

  public async release(dto: ReleaseLockDto): Promise<{ released: boolean }> {
    return this.client.post<{ released: boolean }>('/automation-locks/release', dto);
  }

  public async acquireLock(sequenceId: string, entityId: string, ownerId = 'worker', leaseDurationMs = 60000): Promise<LockResponse> {
    return this.acquire({ sequenceId, entityId, ownerId, leaseDurationMs });
  }

  public async releaseLock(sequenceId: string, entityId: string, ownerId = 'worker'): Promise<{ released: boolean }> {
    return this.release({ sequenceId, entityId, ownerId });
  }
}
