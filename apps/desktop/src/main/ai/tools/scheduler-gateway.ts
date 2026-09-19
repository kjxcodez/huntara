import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { LocalEventBus, AppEvent } from '../../lib/event-bus';
import type { SchedulerGateway, ToolResult, ExecutionContext } from '@huntara/agent-core';
import { WorkspaceManager } from '../../lib/workspace-manager';

export class SchedulerGatewayImpl implements SchedulerGateway {
  private readonly db: Database.Database;
  private readonly eventBus: LocalEventBus;

  constructor(db: Database.Database, eventBus: LocalEventBus) {
    this.db = db;
    this.eventBus = eventBus;
  }

  /**
   * Submits a background worker task via SdkClient and returns the queued Job ID immediately.
   */
  public async submit(
    jobType: string,
    payload: unknown,
    context: ExecutionContext
  ): Promise<string> {
    const jobId = context.jobId || randomUUID();
    const sdk = WorkspaceManager.getSdk();

    await sdk.jobs.create({
      id: jobId,
      type: jobType,
      priority: 5,
      payload: (payload || {}) as Record<string, unknown>
    });

    return jobId;
  }

  /**
   * Cancels a queued or running background job.
   */
  public async cancel(jobId: string, _workspaceId: string): Promise<void> {
    const sdk = WorkspaceManager.getSdk();
    await sdk.jobs.cancel(jobId);
  }

  /**
   * Submits a background worker task and awaits its eventual success/failure outcome.
   */
  public async submitAndAwait<TInput = unknown, TOutput = unknown>(
    jobType: string,
    payload: TInput,
    context: ExecutionContext
  ): Promise<ToolResult<TOutput>> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const jobId = context.jobId || randomUUID();

    try {
      await this.submit(jobType, payload, { ...context, jobId });
    } catch (dbErr: any) {
      return {
        success: false,
        error: {
          code: 'SCHEDULER_ERROR',
          message: `Job submission failed: ${dbErr.message}`,
          isRetryable: true
        },
        metadata: {
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          attempt: 1,
          workspaceId: context.workspaceId,
          traceId: context.traceId,
          jobId,
          cached: false,
          retryCount: 0
        }
      };
    }

    return new Promise<ToolResult<TOutput>>((resolve) => {
      let unsubscribeCompleted: () => void;
      let unsubscribeFailed: () => void;
      let unsubscribeCancelled: () => void;

      const cleanup = () => {
        if (unsubscribeCompleted) unsubscribeCompleted();
        if (unsubscribeFailed) unsubscribeFailed();
        if (unsubscribeCancelled) unsubscribeCancelled();
      };

      const timeoutMs = 600_000; // 10 minute safeguard timeout
      const timeoutTimer = setTimeout(() => {
        cleanup();
        resolve({
          success: false,
          error: {
            code: 'TIMEOUT',
            message: `Tool execution timed out after ${timeoutMs}ms`,
            isRetryable: false
          },
          metadata: {
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
            attempt: 1,
            workspaceId: context.workspaceId,
            traceId: context.traceId,
            jobId,
            cached: false,
            retryCount: 0
          }
        });
      }, timeoutMs);

      if (context.abortSignal) {
        if (context.abortSignal.aborted) {
          clearTimeout(timeoutTimer);
          cleanup();
          resolve({
            success: false,
            error: {
              code: 'CANCELLED_BY_USER',
              message: 'Tool execution was aborted.',
              isRetryable: false
            },
            metadata: {
              startedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - startTime,
              attempt: 1,
              workspaceId: context.workspaceId,
              traceId: context.traceId,
              jobId,
              cached: false,
              retryCount: 0
            }
          });
          return;
        }

        context.abortSignal.addEventListener('abort', () => {
          clearTimeout(timeoutTimer);
          cleanup();
          resolve({
            success: false,
            error: {
              code: 'CANCELLED_BY_USER',
              message: 'Tool execution was aborted.',
              isRetryable: false
            },
            metadata: {
              startedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - startTime,
              attempt: 1,
              workspaceId: context.workspaceId,
              traceId: context.traceId,
              jobId,
              cached: false,
              retryCount: 0
            }
          });
        });
      }

      unsubscribeCompleted = this.eventBus.subscribe('job:completed', (event: AppEvent) => {
        if (event.payload?.jobId === jobId) {
          clearTimeout(timeoutTimer);
          cleanup();
          resolve({
            success: true,
            data: event.payload?.result as TOutput,
            metadata: {
              startedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - startTime,
              attempt: 1,
              workspaceId: context.workspaceId,
              traceId: context.traceId,
              jobId,
              cached: false,
              retryCount: 0
            }
          });
        }
      });

      unsubscribeFailed = this.eventBus.subscribe('job:failed', (event: AppEvent) => {
        if (event.payload?.jobId === jobId) {
          clearTimeout(timeoutTimer);
          cleanup();
          resolve({
            success: false,
            error: {
              code: 'WORKER_ERROR',
              message: event.payload?.error || 'Job failed without an explicit error message.',
              isRetryable: false
            },
            metadata: {
              startedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - startTime,
              attempt: 1,
              workspaceId: context.workspaceId,
              traceId: context.traceId,
              jobId,
              cached: false,
              retryCount: 0
            }
          });
        }
      });

      unsubscribeCancelled = this.eventBus.subscribe('job:cancelled', (event: AppEvent) => {
        if (event.payload?.jobId === jobId) {
          clearTimeout(timeoutTimer);
          cleanup();
          resolve({
            success: false,
            error: {
              code: 'CANCELLED_BY_USER',
              message: 'Job was cancelled before completion.',
              isRetryable: false
            },
            metadata: {
              startedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - startTime,
              attempt: 1,
              workspaceId: context.workspaceId,
              traceId: context.traceId,
              jobId,
              cached: false,
              retryCount: 0
            }
          });
        }
      });
    });
  }

  /**
   * Queries the current status of a background job.
   */
  public async status(
    jobId: string,
    _workspaceId: string
  ): Promise<
    | 'queued'
    | 'running'
    | 'waiting'
    | 'retrying'
    | 'paused'
    | 'cancelled'
    | 'completed'
    | 'failed'
    | 'interrupted'
    | 'unknown'
  > {
    try {
      const sdk = WorkspaceManager.getSdk();
      const job = await sdk.jobs.get(jobId);
      return (job?.status as any) || 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
