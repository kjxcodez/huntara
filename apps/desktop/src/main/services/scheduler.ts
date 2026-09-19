import { type ChildProcess, fork } from 'child_process';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import type { SdkClient } from '@leadforge/sdk';
import {
  type Job,
  DEFAULT_SCHEDULER_POLICY,
  resolveSchedulerPolicy,
  type SchedulerPolicy,
  OUTREACH_JOB_TYPES,
  DISCOVERY_JOB_TYPES,
  resolveSchedulerCapacityAllocation
} from '@leadforge/schema';

const isDev =
  process.env.NODE_ENV === 'development' ||
  (typeof app !== 'undefined' && app?.isPackaged === false);
import { LocalEventBus } from '../lib/event-bus';
import { AppLogger } from '../lib/logger';
import { decryptSecret } from '../lib/crypto';
import { loadSession } from '../lib/session';
import { loadConfig } from '../lib/config';
import { ProjectionService } from './projection-service';
import { getDatabase } from '../database/connection';
import type { SchedulerConfig } from '../../shared/types/job';
import type { MainToWorkerMsg } from '../../shared/types/ipc';

interface GmailOAuthAccountRow {
  provider?: string | null;
  refreshToken?: string | null;
  accessToken?: string | null;
  tokenExpiresAt?: string | null;
  email?: string | null;
}

/**
 * Injects decrypted Gmail OAuth credentials into a worker job's `_secrets`.
 * Only gmail_oauth accounts receive these secrets (least privilege).
 */
function injectGmailOAuthSecrets(secrets: Record<string, string>, acc: GmailOAuthAccountRow): void {
  const isOAuth =
    (acc.provider || '').toLowerCase() === 'gmail_oauth' || Boolean(acc.refreshToken);
  if (!isOAuth) return;

  secrets['gmail.provider'] = 'gmail_oauth';
  secrets['gmail.user'] = acc.email || '';
}

export type SchedulerState =
  | 'STOPPED'
  | 'ACTIVE'
  | 'IDLE'
  | 'BACKING_OFF'
  | 'PAUSED_OFFLINE';

/**
 * JobScheduler acts as an ephemeral execution coordinator for background tasks,
 * dispatching jobs claimed atomically from the authoritative MongoDB store
 * into sandboxed child processes.
 */
export class JobScheduler {
  private timerId: NodeJS.Timeout | null = null;
  private isTickRunning = false;
  private state: SchedulerState = 'STOPPED';
  private consecutiveEmptyClaims = 0;
  private readonly activePollingInterval = 1500; // 1.5s when active work present
  private readonly baseIdleInterval = 2000; // 2s base idle
  private readonly maxIdleInterval = 15000; // 15s max backoff
  private currentInterval = 2000;
  private totalClaimRequests = 0;
  private activeWorkers = new Map<string, ChildProcess>();
  /** Tracks pending hard-kill timeouts for soft-cancel fallback. */
  private cancelTimeouts = new Map<string, NodeJS.Timeout>();
  /** Tracks pending cancel resolvers to return a Promise from cancelJob. */
  private pendingCancels = new Map<string, () => void>();
  /** Per-job heartbeat watchdog state. */
  private heartbeats = new Map<string, { intervalId: NodeJS.Timeout; lastPongAt: number }>();
  /** ms between ping commands sent to each active worker. */
  private readonly heartbeatIntervalMs = 10_000;
  /** ms after the last pong at which the worker is considered stalled and killed. */
  private readonly heartbeatTimeoutMs = 30_000;
  /** Active concurrency limits configured for this workspace runtime. */
  private policy: SchedulerConfig = {
    globalMaxConcurrency: DEFAULT_SCHEDULER_POLICY.globalMaxConcurrency,
    typeLimits: { ...DEFAULT_SCHEDULER_POLICY.typeLimits }
  };
  /** Tracks the number of currently active workers for each job type. */
  private typeActiveCount = new Map<string, number>();
  /** Tracks terminal jobs to guard against duplicate completion callbacks or late crash events. */
  private terminalJobs = new Set<string>();
  /** Tracks last claimed job class to alternate fairly when both classes have pending work. */
  private lastClaimedClass: 'outreach' | 'discovery' | null = null;
  /** Phase 18: Watchdog tracking of worker crashes per job type. */
  private workerCrashes = new Map<string, { count: number; windowStart: number }>();
  /** Periodic timer for automated inbound reply polling and reconciliation. */
  private reliabilityTimerId: NodeJS.Timeout | null = null;
  private isPollingReplies = false;
  private isReconcilingAmbiguous = false;
  private isReconcilingOrphans = false;

  constructor(
    private workspaceId: string,
    private sdk: SdkClient,
    private eventBus: LocalEventBus
  ) {}

  /**
   * Sets active scheduler policy for this workspace runtime.
   */
  public setPolicy(policy: SchedulerConfig | SchedulerPolicy): void {
    const resolved = resolveSchedulerPolicy(policy);
    this.policy = {
      globalMaxConcurrency: resolved.globalMaxConcurrency,
      typeLimits: { ...resolved.typeLimits }
    };
  }

  /**
   * Returns a copy of the current active scheduler concurrency policy.
   */
  public getPolicy(): SchedulerConfig {
    return {
      globalMaxConcurrency: this.policy.globalMaxConcurrency,
      typeLimits: { ...this.policy.typeLimits }
    };
  }

  public get isActive(): boolean {
    return this.state !== 'STOPPED' && this.state !== 'PAUSED_OFFLINE';
  }

  public getState(): SchedulerState {
    return this.state;
  }

  public getCurrentInterval(): number {
    return this.currentInterval;
  }

  public getConsecutiveEmptyClaims(): number {
    return this.consecutiveEmptyClaims;
  }

  public getTotalClaimRequests(): number {
    return this.totalClaimRequests;
  }

  public get activeWorkerCount(): number {
    return this.activeWorkers.size;
  }

  /**
   * Starts periodic polling loop and triggers startup recovery of stale leases.
   * Optionally accepts a runtime-loaded concurrency policy.
   */
  public async start(policy?: SchedulerConfig | SchedulerPolicy): Promise<void> {
    if (policy) {
      this.setPolicy(policy);
    }
    if (this.state !== 'STOPPED') return;
    this.state = 'ACTIVE';
    this.consecutiveEmptyClaims = 0;
    this.currentInterval = this.baseIdleInterval;

    // Reconcile stale jobs on startup via authoritative MongoDB API
    try {
      const recoveryResult = await this.sdk.jobs.recover(60_000).catch((err) => {
        AppLogger.warn(
          'JobScheduler',
          `Startup job recovery call encountered warning: ${err.message || String(err)}`,
          this.workspaceId
        );
        return { recovered: 0, failed: 0 };
      });

      if (recoveryResult && (recoveryResult.recovered > 0 || recoveryResult.failed > 0)) {
        AppLogger.info(
          'JobScheduler',
          `Reconciled stale jobs on startup: ${recoveryResult.recovered} retried, ${recoveryResult.failed} failed.`,
          this.workspaceId
        );
      }
    } catch (err) {
      AppLogger.error(
        'JobScheduler',
        'Failed to reconcile stale jobs on startup',
        this.workspaceId,
        err
      );
    }

    // Reconcile orphaned SQLite RUNNING executions on startup
    try {
      const orphanResult = await this.reconcileOrphanedExecutions();
      if (orphanResult.recovered > 0 || orphanResult.updated > 0) {
        AppLogger.info(
          'JobScheduler',
          `Reconciled orphaned executions on startup: ${orphanResult.recovered} restored to WAITING, ${orphanResult.updated} synchronized.`,
          this.workspaceId
        );
      }
    } catch (orphanErr: any) {
      AppLogger.warn(
        'JobScheduler',
        `Startup orphan reconciliation note: ${orphanErr?.message || orphanErr}`,
        this.workspaceId
      );
    }

    this.scheduleNextTick(0);
    this.startReliabilityRunner();

    AppLogger.info(
      'JobScheduler',
      `Scheduler started for workspace: ${this.workspaceId}`,
      this.workspaceId
    );
  }

  /**
   * Immediately wakes up the scheduler to check for and claim newly submitted jobs.
   * Resets idle backoff to ACTIVE mode and executes a claim tick immediately (<50ms).
   */
  public wakeUp(): void {
    if (this.state === 'STOPPED' || this.state === 'PAUSED_OFFLINE') {
      return;
    }

    this.consecutiveEmptyClaims = 0;
    this.state = 'ACTIVE';
    this.currentInterval = this.activePollingInterval;
    this.scheduleNextTick(0);
  }

  /**
   * Pauses the scheduler loop during offline or degraded connectivity.
   */
  public pauseOffline(): void {
    if (this.state === 'STOPPED') return;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.state = 'PAUSED_OFFLINE';
    AppLogger.info('JobScheduler', 'Scheduler paused while connectivity is offline/degraded', this.workspaceId);
  }

  /**
   * Resumes the scheduler loop when connectivity is restored to ONLINE.
   */
  public resumeOnline(): void {
    if (this.state !== 'PAUSED_OFFLINE') return;
    this.state = 'ACTIVE';
    this.consecutiveEmptyClaims = 0;
    this.currentInterval = this.activePollingInterval;
    AppLogger.info('JobScheduler', 'Scheduler resumed following connection recovery', this.workspaceId);
    this.scheduleNextTick(0);
  }

  /**
   * Schedules the next polling tick with adaptive backoff calculation.
   */
  private scheduleNextTick(customDelay?: number): void {
    if (this.state === 'STOPPED' || this.state === 'PAUSED_OFFLINE') {
      return;
    }

    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    let delay: number;
    if (customDelay !== undefined) {
      delay = customDelay;
    } else if (this.activeWorkers.size > 0) {
      this.state = 'ACTIVE';
      this.consecutiveEmptyClaims = 0;
      this.currentInterval = this.activePollingInterval;
      delay = this.activePollingInterval;
    } else {
      if (this.consecutiveEmptyClaims === 0) {
        this.state = 'IDLE';
        this.currentInterval = this.baseIdleInterval; // 2s
      } else if (this.consecutiveEmptyClaims === 1) {
        this.state = 'BACKING_OFF';
        this.currentInterval = 4000; // 4s
      } else if (this.consecutiveEmptyClaims === 2) {
        this.state = 'BACKING_OFF';
        this.currentInterval = 8000; // 8s
      } else {
        this.state = 'BACKING_OFF';
        this.currentInterval = this.maxIdleInterval; // 15s
      }
      delay = this.currentInterval;
    }

    this.timerId = setTimeout(() => {
      this.tick().catch((err) => {
        AppLogger.error('JobScheduler', 'Unhandled error in scheduler tick', this.workspaceId, err);
      });
    }, delay);
  }

  /**
   * Stops the polling loop and terminates all active child workers.
   */
  public async stop(): Promise<void> {
    this.state = 'STOPPED';
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    if (this.reliabilityTimerId) {
      clearInterval(this.reliabilityTimerId);
      this.reliabilityTimerId = null;
    }

    // Clear any pending hard-kill fallback timeouts before shutdown.
    for (const t of this.cancelTimeouts.values()) clearTimeout(t);
    this.cancelTimeouts.clear();

    for (const resolveCancel of this.pendingCancels.values()) resolveCancel();
    this.pendingCancels.clear();

    // Clear all heartbeat intervals before terminating workers.
    for (const jobId of [...this.heartbeats.keys()]) this.clearHeartbeat(jobId);

    for (const [jobId, worker] of this.activeWorkers.entries()) {
      AppLogger.warn(
        'JobScheduler',
        `Terminating job "${jobId}" due to scheduler stop`,
        this.workspaceId
      );
      try {
        worker.kill('SIGTERM');
      } catch {}
    }
    this.activeWorkers.clear();
    this.typeActiveCount.clear();
    this.terminalJobs.clear();
    this.lastClaimedClass = null;
    AppLogger.info(
      'JobScheduler',
      `Scheduler stopped for workspace: ${this.workspaceId}`,
      this.workspaceId
    );
  }

  /**
   * Starts periodic background reliability runner for automatic inbound reply polling (every 2m)
   * and ambiguous delivery reconciliation (every 5m) with mutex locking to prevent overlap.
   */
  private startReliabilityRunner(): void {
    if (this.reliabilityTimerId) return;

    let lastPollAt = Date.now();
    let lastReconcileAt = Date.now();
    let lastOrphanCheckAt = Date.now();

    this.reliabilityTimerId = setInterval(async () => {
      if (this.state === 'STOPPED' || this.state === 'PAUSED_OFFLINE') return;
      const now = Date.now();

      // 1. Inbound reply poll every 2 minutes (120s)
      if (now - lastPollAt >= 120_000 && !this.isPollingReplies) {
        this.isPollingReplies = true;
        lastPollAt = now;
        try {
          const pollRes = await this.sdk.emailDeliveries.pollReplies().catch(() => []);
          if (Array.isArray(pollRes) && pollRes.length > 0) {
            const matched = pollRes.reduce((acc: number, r: any) => acc + (r.matchedCount || 0), 0);
            if (matched > 0) {
              AppLogger.info(
                'JobScheduler',
                `Background inbound reply poll processed: ${matched} correlated reply/replies.`,
                this.workspaceId
              );
            }
          }
        } catch (err: any) {
          AppLogger.warn(
            'JobScheduler',
            `Background reply poller note: ${err.message}`,
            this.workspaceId
          );
        } finally {
          this.isPollingReplies = false;
        }
      }

      // 2. Ambiguous deliveries reconciliation check every 5 minutes (300s)
      if (now - lastReconcileAt >= 300_000 && !this.isReconcilingAmbiguous) {
        this.isReconcilingAmbiguous = true;
        lastReconcileAt = now;
        try {
          await this.sdk.emailDeliveries.reconcileAmbiguous(10).catch(() => []);
          await this.sdk.emailDeliveries.reconcile({ maxAgeMs: 300_000 }).catch(() => ({}));
        } catch (rErr: any) {
          AppLogger.warn(
            'JobScheduler',
            `Background delivery reconciliation note: ${rErr.message}`,
            this.workspaceId
          );
        } finally {
          this.isReconcilingAmbiguous = false;
        }
      }

      // 3. Reconcile orphaned SQLite RUNNING executions every 60 seconds
      if (now - lastOrphanCheckAt >= 60_000 && !this.isReconcilingOrphans) {
        this.isReconcilingOrphans = true;
        lastOrphanCheckAt = now;
        try {
          await this.reconcileOrphanedExecutions();
        } catch {} finally {
          this.isReconcilingOrphans = false;
        }
      }
    }, 30_000);
  }

  /**
   * Reconciles orphaned executions stuck in RUNNING in local SQLite with authoritative MongoDB state.
   * Runs at startup and periodically.
   * If MongoDB execution is WAITING and no active job exists, restores SQLite to WAITING.
   * If MongoDB execution is terminal (COMPLETED, FAILED, CANCELLED), projects terminal state.
   * If MongoDB campaign is STOPPED or PAUSED, projects cancellation or pause.
   */
  public async reconcileOrphanedExecutions(): Promise<{ recovered: number; updated: number }> {
    let recovered = 0;
    let updated = 0;
    try {
      const db = getDatabase(this.workspaceId);
      const runningExecs = db
        .prepare(`
          SELECT se.id, se.sequenceId, se.contactId, se.campaignId, se.currentStep, se.nextExecutionAt, se.updatedAt
          FROM sequence_executions se
          WHERE se.workspaceId = ?
            AND UPPER(se.status) = 'RUNNING'
            AND se.deletedAt IS NULL
          LIMIT 50
        `)
        .all(this.workspaceId) as Array<{
          id: string;
          sequenceId: string;
          contactId: string;
          campaignId?: string;
          currentStep?: number;
          nextExecutionAt?: string;
          updatedAt?: string;
        }>;

      if (runningExecs.length === 0) return { recovered: 0, updated: 0 };

      const nowIso = new Date().toISOString();

      for (const exec of runningExecs) {
        try {
          const mongoExec = await this.sdk.executions.get(exec.id).catch(() => null);
          if (!mongoExec) {
            // Execution does not exist on server or network error; skip
            continue;
          }

          const mongoStatus = String(mongoExec.status || '').toUpperCase();

          if (['COMPLETED', 'FAILED', 'CANCELLED', 'REPLIED'].includes(mongoStatus)) {
            db.prepare(`
              UPDATE sequence_executions
              SET status = ?, updatedAt = ?
              WHERE id = ? AND workspaceId = ?
            `).run(mongoStatus, nowIso, exec.id, this.workspaceId);
            updated++;
          } else if (mongoStatus === 'PAUSED') {
            db.prepare(`
              UPDATE sequence_executions
              SET status = 'PAUSED', updatedAt = ?
              WHERE id = ? AND workspaceId = ?
            `).run(nowIso, exec.id, this.workspaceId);
            updated++;
          } else if (mongoStatus === 'WAITING' || mongoStatus === 'RUNNING') {
            // Check campaign status if applicable
            if (exec.campaignId) {
              const camp = await this.sdk.campaigns.get(exec.campaignId).catch(() => null);
              if (camp) {
                const campStatus = String(camp.status || '').toUpperCase();
                if (campStatus === 'STOPPED' || campStatus === 'FAILED') {
                  db.prepare(`
                    UPDATE sequence_executions
                    SET status = 'CANCELLED', updatedAt = ?
                    WHERE id = ? AND workspaceId = ?
                  `).run(nowIso, exec.id, this.workspaceId);
                  updated++;
                  continue;
                }
                if (campStatus === 'PAUSED') {
                  db.prepare(`
                    UPDATE sequence_executions
                    SET status = 'PAUSED', updatedAt = ?
                    WHERE id = ? AND workspaceId = ?
                  `).run(nowIso, exec.id, this.workspaceId);
                  updated++;
                  continue;
                }
              }
            }

            // Restore orphaned execution to WAITING with nextExecutionAt
            const nextAt = mongoExec.nextExecutionAt
              ? new Date(mongoExec.nextExecutionAt).toISOString()
              : (exec.nextExecutionAt || nowIso);

            if (mongoStatus === 'RUNNING') {
              // Ensure MongoDB execution is also set to WAITING so it is cleanly resumable
              await this.sdk.executions.update(exec.id, {
                status: 'WAITING',
                nextExecutionAt: nextAt
              }).catch(() => {});
            }

            db.prepare(`
              UPDATE sequence_executions
              SET status = 'WAITING', nextExecutionAt = ?, updatedAt = ?
              WHERE id = ? AND workspaceId = ?
            `).run(nextAt, nowIso, exec.id, this.workspaceId);
            recovered++;
            AppLogger.info('JobScheduler', `Recovered orphaned RUNNING execution ${exec.id} to WAITING`, this.workspaceId);
          }
        } catch (execErr: any) {
          AppLogger.warn('JobScheduler', `Orphan reconciliation error for ${exec.id}: ${execErr.message}`, this.workspaceId);
        }
      }
    } catch (err: any) {
      AppLogger.warn('JobScheduler', `Orphaned execution scan skipped: ${err.message}`, this.workspaceId);
    }
    return { recovered, updated };
  }

  /**
   * Ticks to evaluate job slots and claim pending items from MongoDB.
   */
  private async tick(): Promise<void> {
    if (this.isTickRunning) return;
    if (this.state === 'STOPPED' || this.state === 'PAUSED_OFFLINE') return;
    this.isTickRunning = true;

    try {
      // 1. WAITING Sequence Recovery: Scan SQLite sequence_executions for due WAITING executions
      try {
        const db = getDatabase(this.workspaceId);
        const nowIso = new Date().toISOString();

        // Cancel any WAITING executions belonging to permanently STOPPED or FAILED campaigns
        try {
          db.prepare(`
            UPDATE sequence_executions
            SET status = 'CANCELLED', updatedAt = ?
            WHERE workspaceId = ?
              AND UPPER(status) = 'WAITING'
              AND campaignId IN (
                SELECT id FROM campaigns
                WHERE workspaceId = ? AND UPPER(status) IN ('STOPPED', 'FAILED')
              )
          `).run(nowIso, this.workspaceId, this.workspaceId);
        } catch {}

        const dueExecutions = db
          .prepare(`
            SELECT se.id, se.sequenceId, se.contactId, se.campaignId, se.currentStep, se.nextExecutionAt
            FROM sequence_executions se
            LEFT JOIN campaigns c ON se.campaignId = c.id
            WHERE se.workspaceId = ?
              AND UPPER(se.status) = 'WAITING'
              AND se.nextExecutionAt IS NOT NULL
              AND strftime('%s', se.nextExecutionAt) <= strftime('%s', ?)
              AND se.deletedAt IS NULL
              AND (se.campaignId IS NULL OR UPPER(COALESCE(c.status, 'ACTIVE')) = 'ACTIVE')
            LIMIT 20
          `)
          .all(this.workspaceId, nowIso) as Array<{
            id: string;
            sequenceId: string;
            contactId: string;
            campaignId?: string;
            currentStep?: number;
            nextExecutionAt?: string;
          }>;

        for (const exec of dueExecutions) {
          // Authoritative MongoDB campaign safety gate: verify campaign status in MongoDB
          if (exec.campaignId) {
            try {
              const mongoCampaign = await this.sdk.campaigns.get(exec.campaignId).catch(() => null);
              if (mongoCampaign) {
                const campStatus = String(mongoCampaign.status || '').toUpperCase();
                if (campStatus === 'STOPPED' || campStatus === 'FAILED') {
                  db.prepare(`
                    UPDATE sequence_executions
                    SET status = 'CANCELLED', updatedAt = ?
                    WHERE id = ? AND workspaceId = ?
                  `).run(nowIso, exec.id, this.workspaceId);
                  continue;
                }
                if (campStatus === 'PAUSED') {
                  db.prepare(`
                    UPDATE sequence_executions
                    SET status = 'PAUSED', updatedAt = ?
                    WHERE id = ? AND workspaceId = ?
                  `).run(nowIso, exec.id, this.workspaceId);
                  continue;
                }

                // Phase 18: Mailbox Health & Cooldown Gate
                if (mongoCampaign.sendingAccountId) {
                  try {
                    const mailbox = await this.sdk.outreach.getAccount(mongoCampaign.sendingAccountId).catch(() => null);
                    if (mailbox) {
                      const health = (mailbox as any).health;
                      const nowTime = Date.now();
                      if (health?.state === 'AUTH_REQUIRED' || mailbox.status === 'reauth_required') {
                        AppLogger.warn('JobScheduler', `Deferring execution ${exec.id}: mailbox ${mailbox.email} requires authentication`, this.workspaceId);
                        continue;
                      }
                      if (health?.operatorActionRequired || health?.state === 'BLOCKED') {
                        AppLogger.warn('JobScheduler', `Deferring execution ${exec.id}: mailbox ${mailbox.email} is blocked`, this.workspaceId);
                        continue;
                      }
                      if (health?.cooldownUntil && new Date(health.cooldownUntil).getTime() > nowTime) {
                        const cooldownEnd = new Date(health.cooldownUntil).toISOString();
                        db.prepare(`
                          UPDATE sequence_executions
                          SET nextExecutionAt = ?, updatedAt = ?
                          WHERE id = ? AND workspaceId = ? AND UPPER(status) = 'WAITING'
                        `).run(cooldownEnd, nowIso, exec.id, this.workspaceId);
                        AppLogger.info('JobScheduler', `Deferred execution ${exec.id} to ${cooldownEnd} due to mailbox cooldown`, this.workspaceId);
                        continue;
                      }
                    }
                  } catch {}
                }
              }
            } catch {}
          }

          // Atomic compare-and-swap transition in SQLite: WAITING -> RUNNING
          const updateResult = db
            .prepare(`
              UPDATE sequence_executions
              SET status = 'RUNNING', updatedAt = ?
              WHERE id = ? AND UPPER(status) = 'WAITING'
            `)
            .run(nowIso, exec.id);

          if (updateResult.changes === 1) {
            AppLogger.info('JobScheduler', `Recovered WAITING sequence execution: ${exec.id}`, this.workspaceId);
            const idempotencyKey = `workflow_${exec.id}_step${exec.currentStep ?? 0}_${exec.nextExecutionAt || nowIso}`;
            try {
              await this.sdk.jobs.create({
                type: 'automation:workflow',
                idempotencyKey,
                payload: {
                  executionId: exec.id,
                  sequenceId: exec.sequenceId,
                  entityId: exec.contactId,
                  entityType: 'contact',
                  contactId: exec.contactId,
                  campaignId: exec.campaignId
                }
              });
            } catch (createErr: any) {
              AppLogger.error('JobScheduler', `Failed to enqueue automation:workflow job for ${exec.id}`, this.workspaceId, createErr);
              // Revert SQLite status back to WAITING so execution is not permanently orphaned
              try {
                db.prepare(`
                  UPDATE sequence_executions
                  SET status = 'WAITING', updatedAt = ?
                  WHERE id = ? AND UPPER(status) = 'RUNNING'
                `).run(nowIso, exec.id);
              } catch {}
            }
          }
        }
      } catch (recoveryErr) {
        AppLogger.warn('JobScheduler', 'WAITING sequence recovery check skipped or failed', this.workspaceId, recoveryErr);
      }

      const config = this.loadSchedulerConfig();
      const availableCapacity = config.globalMaxConcurrency - this.activeWorkers.size;

      if (availableCapacity > 0) {
        // Calculate currently active worker counts by resource class
        const activeOutreach = (OUTREACH_JOB_TYPES as readonly string[]).reduce(
          (sum, t) => sum + (this.typeActiveCount.get(t) ?? 0),
          0
        );
        const activeDiscovery = (DISCOVERY_JOB_TYPES as readonly string[]).reduce(
          (sum, t) => sum + (this.typeActiveCount.get(t) ?? 0),
          0
        );

        // Derive fair capacity targets and limits from authoritative MongoDB policy
        const allocation = resolveSchedulerCapacityAllocation(config);

        // Filter types that have not exceeded their configured per-type limits
        const filterEligible = (types: readonly string[]) =>
          types.filter((t) => {
            const limit = config.typeLimits[t] ?? 2;
            const current = this.typeActiveCount.get(t) ?? 0;
            return limit > 0 && current < limit;
          });

        const eligibleOutreachTypes = filterEligible(OUTREACH_JOB_TYPES);
        const eligibleDiscoveryTypes = filterEligible(DISCOVERY_JOB_TYPES);
        const otherSupportedTypes = ['mock:test'].filter((t) => {
          const limit = config.typeLimits[t] ?? 2;
          const current = this.typeActiveCount.get(t) ?? 0;
          return limit > 0 && current < limit;
        });

        // Determine which class should be offered the first claim opportunity.
        // Under contention:
        // - If outreach has less than its protected share and discovery is at/above its target, outreach gets priority.
        // - If discovery has less than its target and outreach is at/above its share, discovery gets priority.
        // - If both need capacity, alternate fairly based on lastClaimedClass (defaulting to 'outreach' to ensure protection).
        let preferredClass: 'outreach' | 'discovery' = 'outreach';
        const outreachNeedsCapacity = activeOutreach < allocation.targetOutreachCapacity;
        const discoveryNeedsCapacity = activeDiscovery < allocation.targetDiscoveryCapacity;

        if (outreachNeedsCapacity && !discoveryNeedsCapacity) {
          preferredClass = 'outreach';
        } else if (discoveryNeedsCapacity && !outreachNeedsCapacity) {
          preferredClass = 'discovery';
        } else {
          preferredClass = this.lastClaimedClass === 'outreach' ? 'discovery' : 'outreach';
        }

        // Build ordered claim attempts:
        // 1. Preferred class (if it has eligible types and hasn't exceeded its max capacity)
        // 2. Fallback class (if preferred class has no pending jobs or no eligible types)
        // 3. Other/unclassified types (e.g. mock:test)
        const claimPlan: Array<{ class: 'outreach' | 'discovery' | 'other'; types: string[] }> = [];

        const canOutreachClaim =
          eligibleOutreachTypes.length > 0 && activeOutreach < allocation.maxOutreachCapacity;
        const canDiscoveryClaim =
          eligibleDiscoveryTypes.length > 0 && activeDiscovery < allocation.maxDiscoveryCapacity;

        if (preferredClass === 'outreach') {
          if (canOutreachClaim) {
            claimPlan.push({ class: 'outreach', types: eligibleOutreachTypes });
          }
          if (canDiscoveryClaim) {
            claimPlan.push({ class: 'discovery', types: eligibleDiscoveryTypes });
          }
        } else {
          if (canDiscoveryClaim) {
            claimPlan.push({ class: 'discovery', types: eligibleDiscoveryTypes });
          }
          if (canOutreachClaim) {
            claimPlan.push({ class: 'outreach', types: eligibleOutreachTypes });
          }
        }

        if (otherSupportedTypes.length > 0) {
          claimPlan.push({ class: 'other', types: otherSupportedTypes });
        }

        let claimed: Job | null = null;
        let claimedClass: 'outreach' | 'discovery' | 'other' | null = null;
        const workerId = `desktop-${this.workspaceId.slice(0, 8)}-${Date.now()}-${randomUUID().slice(0, 4)}`;

        for (const attempt of claimPlan) {
          this.totalClaimRequests++;
          claimed = await this.sdk.jobs.claim(attempt.types, workerId).catch(() => null);
          if (claimed) {
            claimedClass = attempt.class;
            break;
          }
        }

        if (claimed) {
          this.consecutiveEmptyClaims = 0;
          this.state = 'ACTIVE';
          if (claimedClass === 'outreach' || claimedClass === 'discovery') {
            this.lastClaimedClass = claimedClass;
          }
          this.runJob(claimed, workerId);

          // If capacity still remains, quickly schedule another tick to claim further jobs
          const remainingCapacity = config.globalMaxConcurrency - this.activeWorkers.size;
          if (remainingCapacity > 0) {
            this.scheduleNextTick(50);
            return;
          }
        } else {
          this.consecutiveEmptyClaims++;
        }
      }
    } catch (err) {
      AppLogger.error('JobScheduler', 'Error in scheduler dispatch phase', this.workspaceId, err);
    } finally {
      this.isTickRunning = false;
      this.scheduleNextTick();
    }
  }

  /**
   * Reads active concurrency configuration for this workspace runtime.
   */
  private loadSchedulerConfig(): SchedulerConfig {
    return this.policy;
  }

  /**
   * Spawns worker process for a job.
   */
  private runJob(job: Job, workerId: string): void {
    AppLogger.info(
      'JobScheduler',
      `Launching job "${job.id}" of type "${job.type}"`,
      this.workspaceId,
      { jobId: job.id }
    );

    this.eventBus.publish('job:starting', { jobId: job.id, workerId });

    const config = loadConfig();
    const workerHostPath = join(__dirname, 'worker.js');
    const worker = fork(workerHostPath, [], {
      env: {
        WORKSPACES_DB_DIR: join(app.getPath('userData'), 'workspaces'),
        PLAYWRIGHT_BROWSERS_PATH:
          process.env.PLAYWRIGHT_BROWSERS_PATH ||
          join(app.getPath('userData'), 'playwright-browsers'),
        API_URL: config.apiUrl,
        NODE_ENV: process.env.NODE_ENV
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      execArgv: isDev ? ['--inspect=0'] : []
    });

    worker.stdout?.on('data', (data: Buffer) => {
      AppLogger.info('WorkerHost', data.toString().trim(), this.workspaceId);
    });
    worker.stderr?.on('data', (data: Buffer) => {
      AppLogger.error('WorkerHost', data.toString().trim(), this.workspaceId);
    });

    this.activeWorkers.set(job.id, worker);
    this.typeActiveCount.set(job.type, (this.typeActiveCount.get(job.type) ?? 0) + 1);

    // Register all IPC message handlers
    worker.on('message', async (rawMsg: unknown) => {
      const msg = rawMsg as any;
      if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

      switch (msg.type) {
        case 'ready':
          await this.sdk.jobs
            .updateStatus(job.id, { status: 'running', workerId })
            .catch((err) => {
              AppLogger.error(
                'JobScheduler',
                `Failed to mark job "${job.id}" running: ${err.message}`,
                this.workspaceId
              );
            });
          this.eventBus.publish('job:started', { jobId: job.id, workerId });

          // Start heartbeat watchdog
          this.heartbeats.set(job.id, {
            lastPongAt: Date.now(),
            intervalId: setInterval(async () => {
              const state = this.heartbeats.get(job.id);
              if (!state) return;

              if (Date.now() - state.lastPongAt >= this.heartbeatTimeoutMs) {
                AppLogger.error(
                  'JobScheduler',
                  `Heartbeat timeout for job "${job.id}" — no pong in ${this.heartbeatTimeoutMs}ms. Killing worker.`,
                  this.workspaceId,
                  { jobId: job.id }
                );
                this.clearHeartbeat(job.id);
                const w = this.activeWorkers.get(job.id);
                if (w) {
                  try {
                    w.kill('SIGKILL');
                  } catch {}
                  this.activeWorkers.delete(job.id);
                }
                this.handleJobFailure(job.id, job.retryCount, job.maxRetries, 'Heartbeat timeout', workerId, job.type, job.payload);
                this.eventBus.publish('job:heartbeat:timeout', { jobId: job.id });
              } else if (worker.connected) {
                worker.send({ command: 'ping' } as MainToWorkerMsg);
                await this.sdk.jobs.heartbeat(job.id, workerId).catch(() => {});
              }
            }, this.heartbeatIntervalMs)
          });
          break;

        case 'pong': {
          const hb = this.heartbeats.get(job.id);
          if (hb) hb.lastPongAt = Date.now();
          break;
        }

        case 'progress':
          await this.sdk.jobs
            .checkpoint(job.id, {
              progress: msg.progress,
              checkpointData: msg.metadata || {},
              workerId
            })
            .catch(() => {});
          this.eventBus.publish('job:progress', {
            jobId: job.id,
            progress: msg.progress,
            metadata: msg.metadata
          });
          break;

        case 'log':
          AppLogger.log({
            workspaceId: this.workspaceId,
            workerId,
            severity: msg.severity || 'info',
            task: job.type,
            message: msg.message,
            metadata: msg.meta
          });
          break;

        case 'notify': {
          const { Notification } = require('electron');
          if (Notification.isSupported()) {
            new Notification({ title: msg.title || 'HUNTARA', body: msg.body }).show();
          }
          break;
        }

        case 'checkpoint':
          await this.sdk.jobs
            .checkpoint(job.id, {
              progress: job.progress || 0,
              checkpointData: msg.data,
              workerId
            })
            .catch(() => {});
          break;

        case 'paused':
          this.clearHeartbeat(job.id);
          this.activeWorkers.delete(job.id);
          this.decrementTypeCount(job.type);
          await this.sdk.jobs
            .updateStatus(job.id, { status: 'paused', workerId })
            .catch(() => {});
          this.eventBus.publish('job:paused', { jobId: job.id });
          break;

        case 'cancelled': {
          const hardKill = this.cancelTimeouts.get(job.id);
          if (hardKill) {
            clearTimeout(hardKill);
            this.cancelTimeouts.delete(job.id);
          }
          this.clearHeartbeat(job.id);
          this.activeWorkers.delete(job.id);
          this.decrementTypeCount(job.type);
          await this.sdk.jobs.cancel(job.id).catch(() => {});
          this.eventBus.publish('job:cancelled', { jobId: job.id });

          const resolveCancel = this.pendingCancels.get(job.id);
          if (resolveCancel) {
            resolveCancel();
            this.pendingCancels.delete(job.id);
          }
          break;
        }

        case 'success':
          this.handleJobSuccess(job.id, msg.result, workerId, job.type, job.payload);
          break;

        case 'error':
          this.handleJobFailure(job.id, job.retryCount, job.maxRetries, msg.error, workerId, job.type, job.payload);
          break;

        case 'automation_event':
          this.eventBus.publish((msg as any).event, (msg as any).payload);
          break;
      }
    });

    // Crash / unexpected exit handler
    worker.on('exit', (code, signal) => {
      this.clearHeartbeat(job.id);
      const hadWorker = this.activeWorkers.delete(job.id);
      if (hadWorker && job.type) {
        this.decrementTypeCount(job.type);
      }

      const errorMsg = `Worker process exited abnormally with code ${code} (signal: ${signal})`;
      if (code !== 0 && code !== null) {
        AppLogger.error(
          'JobScheduler',
          `Job "${job.id}" worker crashed: ${errorMsg}`,
          this.workspaceId,
          { jobId: job.id }
        );
        this.handleJobFailure(job.id, job.retryCount, job.maxRetries, errorMsg, workerId, job.type, job.payload);
      }

      const resolveCancel = this.pendingCancels.get(job.id);
      if (resolveCancel) {
        resolveCancel();
        this.pendingCancels.delete(job.id);
      }
    });

    // Build payload and inject decrypted secrets
    const parsedPayload = typeof job.payload === 'object' && job.payload !== null ? { ...job.payload } : {};
    if (job.checkpointData) {
      parsedPayload._checkpoint = job.checkpointData;
    }

    try {
      const secrets: Record<string, string> = {};
      const activeSession = loadSession();
      if (activeSession?.accessToken) {
        secrets['sessionToken'] = activeSession.accessToken;
      }
      parsedPayload._secrets = secrets;
      parsedPayload._config = {
        apiUrl: config.apiUrl
      };
    } catch (err) {
      AppLogger.error(
        'JobScheduler',
        'Failed to load secrets for worker payload',
        this.workspaceId,
        err
      );
    }

    worker.send({
      command: 'start',
      jobId: job.id,
      workspaceId: this.workspaceId,
      type: job.type,
      payload: parsedPayload
    } as MainToWorkerMsg);
  }

  private async handleJobSuccess(
    jobId: string,
    result: any,
    workerId?: string,
    jobType?: string,
    payload?: any
  ): Promise<void> {
    if (this.terminalJobs.has(jobId)) {
      return;
    }
    this.terminalJobs.add(jobId);

    AppLogger.info('JobScheduler', `Job "${jobId}" completed successfully.`, this.workspaceId, {
      jobId
    });
    this.clearHeartbeat(jobId);

    await this.sdk.jobs.complete(jobId, workerId).catch((err) => {
      AppLogger.error('JobScheduler', `Failed to complete job "${jobId}": ${err.message}`, this.workspaceId);
    });

    // Auto-queue intelligence enrichment on website crawl completion
    try {
      if (jobType === 'crawler:website' && payload?.companyId) {
        await this.sdk.jobs.create({
          type: 'enrich:intelligence',
          priority: 5,
          payload: { companyId: payload.companyId }
        });
        AppLogger.info(
          'JobScheduler',
          `Auto-queued enrich:intelligence job for Company: ${payload.companyId}`,
          this.workspaceId
        );
      }
    } catch (err) {
      AppLogger.error(
        'JobScheduler',
        'Failed to auto-queue intelligence enrichment after website crawl',
        this.workspaceId,
        err
      );
    }

    const hadWorker = this.activeWorkers.delete(jobId);
    if (hadWorker && jobType) this.decrementTypeCount(jobType);
    this.wakeUp();

    // Reconcile worker mutations authoritatively into workspace SQLite projection
    await ProjectionService.reconcileJobOutcome(
      this.workspaceId,
      jobType,
      payload,
      result,
      this.sdk
    ).catch((projErr) => {
      AppLogger.warn('JobScheduler', `Projection reconciliation note: ${projErr.message}`, this.workspaceId);
    });

    const entityId = payload?.entityId || payload?.companyId || payload?.contactId || '';
    const entityType = payload?.entityType || (payload?.companyId ? 'company' : payload?.contactId ? 'contact' : '');

    this.eventBus.publish('job:completed', {
      jobId,
      jobType,
      type: jobType,
      entityId,
      entityType,
      result,
      payload
    });

    const resolveCancel = this.pendingCancels.get(jobId);
    if (resolveCancel) {
      resolveCancel();
      this.pendingCancels.delete(jobId);
    }
  }

  private async handleJobFailure(
    jobId: string,
    currentRetry: number,
    maxRetries: number,
    error: string,
    workerId?: string,
    jobType?: string,
    payload?: any
  ): Promise<void> {
    if (this.terminalJobs.has(jobId)) {
      return;
    }

    this.clearHeartbeat(jobId);
    const nextRetry = currentRetry + 1;
    const worker = this.activeWorkers.get(jobId);
    if (worker) {
      try {
        worker.kill('SIGTERM');
      } catch {}
    }
    const hadWorker = this.activeWorkers.delete(jobId);
    if (hadWorker && jobType) {
      this.decrementTypeCount(jobType);
    }
    if (jobType) {
      this.recordWorkerCrash(jobType);
    }
    this.wakeUp();

    if (nextRetry <= maxRetries) {
      const delaySec = Math.min(Math.pow(2, nextRetry), 60);
      const scheduledAt = new Date(Date.now() + delaySec * 1000);
      AppLogger.warn(
        'JobScheduler',
        `Job "${jobId}" failed. Retrying (Attempt ${nextRetry}/${maxRetries}). Error: ${error}`,
        this.workspaceId,
        { jobId }
      );
      await this.sdk.jobs
        .updateStatus(jobId, {
          status: 'retrying',
          workerId,
          error,
          scheduledAt
        })
        .catch(() => {});
      this.eventBus.publish('job:failed', { jobId, error, willRetry: true });
    } else {
      this.terminalJobs.add(jobId);
      AppLogger.error(
        'JobScheduler',
        `Job "${jobId}" failed permanently after ${maxRetries} retries. Moving to dead-letter. Error: ${error}`,
        this.workspaceId,
        { jobId }
      );

      // Phase 18: Move to dead-letter with complete execution lineage
      await this.sdk.jobs
        .moveToDeadLetter(jobId, error, {
          campaignId: payload?.campaignId || null,
          executionId: payload?.executionId || null,
          contactId: payload?.contactId || null,
          accountId: payload?.accountId || null,
          failureCategory: 'RETRY_EXHAUSTION',
          lastError: error,
          attemptCount: nextRetry
        })
        .catch(async () => {
          await this.sdk.jobs.fail(jobId, error, workerId).catch(() => {});
        });

      this.eventBus.publish('job:failed', { jobId, error, willRetry: false });

      // Project failure into SQLite for automation workflows
      if (jobType === 'automation:workflow' || payload?.executionId) {
        await ProjectionService.reconcileJobOutcome(
          this.workspaceId,
          jobType,
          payload,
          { status: 'failed', error },
          this.sdk
        ).catch(() => {});
      }
    }

    const resolveCancel = this.pendingCancels.get(jobId);
    if (resolveCancel) {
      resolveCancel();
      this.pendingCancels.delete(jobId);
    }
  }

  /**
   * Request soft job cancellation via IPC and API.
   */
  public async cancelJob(jobId: string): Promise<void> {
    const worker = this.activeWorkers.get(jobId);
    if (worker) {
      AppLogger.warn('JobScheduler', `Sending cancel command to job "${jobId}"`, this.workspaceId, {
        jobId
      });

      worker.send({ command: 'cancel' } as MainToWorkerMsg);

      const cancelPromise = new Promise<void>((resolve) => {
        this.pendingCancels.set(jobId, resolve);
      });

      const hardKillTimeout = setTimeout(async () => {
        if (this.activeWorkers.has(jobId)) {
          AppLogger.error(
            'JobScheduler',
            `Hard-killing job "${jobId}" — cancel not acknowledged within 15s`,
            this.workspaceId,
            { jobId }
          );
          const w = this.activeWorkers.get(jobId);
          try {
            w?.kill('SIGKILL');
          } catch {}
          this.activeWorkers.delete(jobId);
          this.cancelTimeouts.delete(jobId);
          this.clearHeartbeat(jobId);

          await this.sdk.jobs.cancel(jobId).catch(() => {});
          this.eventBus.publish('job:cancelled', { jobId });

          const resolveCancel = this.pendingCancels.get(jobId);
          if (resolveCancel) {
            resolveCancel();
            this.pendingCancels.delete(jobId);
          }
        }
      }, 15000);

      this.cancelTimeouts.set(jobId, hardKillTimeout);
      return cancelPromise;
    } else {
      await this.sdk.jobs.cancel(jobId).catch(() => {});
      this.eventBus.publish('job:cancelled', { jobId });
    }
  }

  /**
   * Request that a running job pause at the next checkpoint boundary.
   */
  public async pauseJob(jobId: string): Promise<void> {
    const worker = this.activeWorkers.get(jobId);
    if (worker) {
      AppLogger.info('JobScheduler', `Sending pause command to job "${jobId}"`, this.workspaceId, {
        jobId
      });
      worker.send({ command: 'pause' } as MainToWorkerMsg);
    } else {
      await this.sdk.jobs.updateStatus(jobId, { status: 'paused' }).catch(() => {});
    }
  }

  private decrementTypeCount(jobType: string): void {
    const current = this.typeActiveCount.get(jobType) ?? 0;
    if (current <= 1) {
      this.typeActiveCount.delete(jobType);
    } else {
      this.typeActiveCount.set(jobType, current - 1);
    }
  }

  private clearHeartbeat(jobId: string): void {
    const hb = this.heartbeats.get(jobId);
    if (hb) {
      clearInterval(hb.intervalId);
      this.heartbeats.delete(jobId);
    }
  }

  /**
   * Records a crash for a worker type and raises an alert if threshold exceeded.
   */
  public recordWorkerCrash(jobType: string): void {
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const current = this.workerCrashes.get(jobType);
    if (!current || now - current.windowStart > windowMs) {
      this.workerCrashes.set(jobType, { count: 1, windowStart: now });
    } else {
      current.count += 1;
      if (current.count >= 3) {
        AppLogger.warn(
          'JobScheduler',
          `Worker watchdog alert: worker type "${jobType}" has crashed ${current.count} times in 10 minutes. Marked as DEGRADED.`,
          this.workspaceId
        );
      }
    }
  }

  /**
   * Returns worker health status across supported job types for the Operations Center UI.
   */
  public getWorkerHealthStatus(): Record<
    string,
    { status: 'HEALTHY' | 'DEGRADED' | 'STALE' | 'FAILED'; crashes: number; active: number }
  > {
    const result: Record<
      string,
      { status: 'HEALTHY' | 'DEGRADED' | 'STALE' | 'FAILED'; crashes: number; active: number }
    > = {};
    const types = [
      'scraper:maps',
      'crawler:website',
      'enrich:intelligence',
      'outreach:campaign',
      'automation:workflow',
      'outreach:imap-poll'
    ];
    const now = Date.now();
    for (const t of types) {
      const crashInfo = this.workerCrashes.get(t);
      const active = this.typeActiveCount.get(t) ?? 0;
      if (crashInfo && now - crashInfo.windowStart < 10 * 60 * 1000 && crashInfo.count >= 3) {
        result[t] = { status: 'DEGRADED', crashes: crashInfo.count, active };
      } else {
        result[t] = { status: 'HEALTHY', crashes: crashInfo?.count ?? 0, active };
      }
    }
    return result;
  }
}
