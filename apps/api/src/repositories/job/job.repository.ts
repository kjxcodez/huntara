import { BaseRepository } from '../base/base.repository.js';
import { JobModel, type JobDocument } from '../../db/models/job.model.js';
import type { JobStatus } from '@huntara/schema';
import { ValidationError, NotFoundError } from '../../errors/index.js';

export const VALID_JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  pending: ['queued', 'cancelled'],
  queued: ['starting', 'paused', 'cancelled'],
  starting: ['running', 'paused', 'cancelled', 'failed', 'retrying', 'completed'],
  running: ['completed', 'paused', 'cancelled', 'failed', 'retrying'],
  waiting: ['queued', 'starting', 'paused', 'cancelled', 'failed'],
  retrying: ['starting', 'queued', 'paused', 'cancelled', 'failed'],
  paused: ['queued', 'starting', 'running', 'cancelled'],
  interrupted: ['queued', 'retrying', 'failed', 'cancelled'],
  completed: [],
  failed: ['queued', 'retrying'],
  cancelled: []
};

export class JobRepository extends BaseRepository<JobDocument> {
  constructor(workspaceId?: string) {
    super(JobModel, workspaceId);
  }

  /**
   * Atomically claims the next eligible pending/queued job for a worker.
   * Guarantees race-condition safety across concurrent workers.
   */
  public async claimJob(
    workerId: string,
    supportedTypes: string[],
    leaseDurationMs: number = 60_000
  ): Promise<JobDocument | null> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

    const filter: any = {
      status: { $in: ['queued', 'retrying'] },
      type: { $in: supportedTypes },
      $or: [{ scheduledAt: null }, { scheduledAt: { $lte: now } }]
    };

    return this.atomicFindOneAndUpdate(
      filter,
      {
        $set: {
          status: 'starting',
          workerId,
          startedAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt,
          updatedAt: now
        }
      },
      {
        sort: { priority: -1, createdAt: 1 }
      }
    );
  }

  /**
   * Saves execution checkpoint data for progress recovery.
   */
  public async checkpoint(
    id: string,
    progress: number,
    checkpointData: Record<string, any>,
    workerId?: string
  ): Promise<JobDocument | null> {
    const now = new Date();
    const filter: any = { _id: id };
    if (workerId) {
      filter.workerId = workerId;
    }

    return this.atomicFindOneAndUpdate(
      filter,
      {
        $set: {
          progress,
          checkpointData,
          checkpointAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt: new Date(now.getTime() + 60_000),
          updatedAt: now
        }
      }
    );
  }

  /**
   * Records a heartbeat to renew lease and prevent job stalling.
   */
  public async heartbeat(
    id: string,
    workerId?: string,
    leaseDurationMs: number = 60_000
  ): Promise<JobDocument | null> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
    const filter: any = { _id: id, status: { $in: ['starting', 'running'] } };
    if (workerId) {
      filter.workerId = workerId;
    }

    return this.atomicFindOneAndUpdate(
      filter,
      {
        $set: {
          lastHeartbeatAt: now,
          leaseExpiresAt,
          updatedAt: now
        }
      }
    );
  }

  /**
   * Enforces controlled state machine transitions.
   */
  public async transitionStatus(
    id: string,
    status: JobStatus,
    workerId?: string,
    error?: string | null,
    durationMs?: number,
    scheduledAt?: Date | null
  ): Promise<JobDocument | null> {
    const current = await this.findById(id);
    if (!current) {
      throw new NotFoundError(`Job with id ${id} not found`);
    }

    const allowed = VALID_JOB_TRANSITIONS[current.status] || [];
    if (!allowed.includes(status)) {
      throw new ValidationError(
        `Invalid job status transition from '${current.status}' to '${status}'. Allowed transitions: ${allowed.join(', ') || 'none (terminal state)'}`
      );
    }

    const filter: any = { _id: id };
    if (workerId && current.workerId && status !== 'cancelled' && status !== 'queued' && status !== 'starting') {
      filter.workerId = workerId;
    }

    const now = new Date();
    const updateSet: any = {
      status,
      updatedAt: now
    };

    if (workerId) updateSet.workerId = workerId;
    if (error !== undefined) updateSet.error = error;
    if (durationMs !== undefined) updateSet.durationMs = durationMs;
    if (scheduledAt !== undefined) updateSet.scheduledAt = scheduledAt;

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updateSet.finishedAt = now;
      updateSet.leaseExpiresAt = null;
    } else if (status === 'paused') {
      updateSet.leaseExpiresAt = null;
    } else if (status === 'retrying') {
      updateSet.leaseExpiresAt = null;
    } else if (status === 'running') {
      if (!current.startedAt) {
        updateSet.startedAt = now;
      }
      updateSet.lastHeartbeatAt = now;
      updateSet.leaseExpiresAt = new Date(now.getTime() + 60_000);
    }

    const updateOps: any = { $set: updateSet };
    if (status === 'retrying') {
      updateOps.$inc = { retryCount: 1 };
    }

    return this.atomicFindOneAndUpdate(filter, updateOps);
  }

  /**
   * Recovers stale or interrupted jobs whose lease expired or heartbeat timed out.
   */
  public async recoverInterruptedJobs(
    staleThresholdMs: number = 60_000
  ): Promise<{ recovered: number; failed: number }> {
    const now = new Date();
    const staleHeartbeatCutoff = new Date(now.getTime() - staleThresholdMs);

    const staleJobs = await this.findMany({
      status: { $in: ['starting', 'running'] },
      $or: [
        { leaseExpiresAt: { $lte: now } },
        { leaseExpiresAt: null, updatedAt: { $lte: staleHeartbeatCutoff } }
      ]
    });

    let recovered = 0;
    let failed = 0;

    for (const job of staleJobs) {
      const nextRetry = (job.retryCount || 0) + 1;
      const maxRetries = job.maxRetries ?? 3;

      if (nextRetry <= maxRetries) {
        const delaySec = Math.min(Math.pow(2, nextRetry), 60);
        const scheduledAt = new Date(now.getTime() + delaySec * 1000);

        await this.atomicFindOneAndUpdate(
          { _id: job._id, status: { $in: ['starting', 'running'] } },
          {
            $set: {
              status: 'retrying',
              error: 'Job execution interrupted: worker lease expired.',
              scheduledAt,
              leaseExpiresAt: null,
              updatedAt: now
            },
            $inc: {
              retryCount: 1,
              recoveryCount: 1
            }
          }
        );
        recovered++;
      } else {
        await this.atomicFindOneAndUpdate(
          { _id: job._id, status: { $in: ['starting', 'running'] } },
          {
            $set: {
              status: 'failed',
              error: 'Job failed permanently: worker lease expired and max retries exceeded.',
              finishedAt: now,
              leaseExpiresAt: null,
              isDeadLetter: true,
              deadLetteredAt: now,
              deadLetterReason: 'worker_lease_expired_retries_exhausted',
              lineageReferences: {
                campaignId: job.payload?.campaignId || null,
                executionId: job.payload?.executionId || null,
                contactId: job.payload?.contactId || null,
                accountId: job.payload?.accountId || null,
                failureCategory: 'LEASE_EXPIRED',
                lastError: 'Job failed permanently: worker lease expired and max retries exceeded.',
                attemptCount: nextRetry
              },
              updatedAt: now
            },
            $inc: {
              recoveryCount: 1
            }
          }
        );
        failed++;
      }
    }

    return { recovered, failed };
  }

  /**
   * Transitions a job into the terminal dead-letter state with full execution lineage.
   */
  public async moveToDeadLetter(
    id: string,
    reason: string,
    lineage?: {
      campaignId?: string | null;
      executionId?: string | null;
      contactId?: string | null;
      accountId?: string | null;
      failureCategory?: string | null;
      lastError?: string | null;
      attemptCount?: number | null;
    }
  ): Promise<JobDocument | null> {
    const now = new Date();
    const filter = this.applyScope({ _id: id } as any);
    const existing = await this.findOne({ _id: id } as any);
    if (!existing) return null;

    const combinedLineage = {
      campaignId: lineage?.campaignId ?? existing.payload?.campaignId ?? null,
      executionId: lineage?.executionId ?? existing.payload?.executionId ?? null,
      contactId: lineage?.contactId ?? existing.payload?.contactId ?? null,
      accountId: lineage?.accountId ?? existing.payload?.accountId ?? null,
      failureCategory: lineage?.failureCategory ?? 'RETRY_EXHAUSTION',
      lastError: lineage?.lastError ?? existing.error ?? reason,
      attemptCount: lineage?.attemptCount ?? existing.retryCount ?? 0
    };

    return this.atomicFindOneAndUpdate(filter, {
      $set: {
        status: 'failed',
        error: reason,
        isDeadLetter: true,
        deadLetteredAt: now,
        deadLetterReason: reason,
        lineageReferences: combinedLineage,
        finishedAt: now,
        leaseExpiresAt: null,
        updatedAt: now
      }
    });
  }

  /**
   * Lists dead-letter jobs for operator inspection, scoped to workspace.
   */
  public async listDeadLetters(
    limit: number = 50,
    offset: number = 0
  ): Promise<{ items: JobDocument[]; total: number }> {
    const filter = this.applyScope({ isDeadLetter: true } as any);
    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ deadLetteredAt: -1, createdAt: -1 }).skip(offset).limit(limit),
      this.model.countDocuments(filter)
    ]);
    return { items, total };
  }

  /**
   * Requeues a dead-letter job for execution by resetting retry counters.
   */
  public async requeueDeadLetter(id: string): Promise<JobDocument | null> {
    const now = new Date();
    const filter = this.applyScope({ _id: id, isDeadLetter: true } as any);
    return this.atomicFindOneAndUpdate(filter, {
      $set: {
        status: 'queued',
        isDeadLetter: false,
        deadLetteredAt: null,
        deadLetterReason: null,
        error: null,
        retryCount: 0,
        workerId: null,
        leaseExpiresAt: null,
        scheduledAt: now,
        updatedAt: now
      }
    });
  }

  /**
   * Finds existing job by idempotency key within workspace.
   */
  public async findByIdempotencyKey(idempotencyKey: string): Promise<JobDocument | null> {
    return this.findOne({ idempotencyKey });
  }
}
