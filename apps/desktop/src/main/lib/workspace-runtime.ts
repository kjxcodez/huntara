import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { BrowserWindow } from 'electron';
import { LocalEventBus } from './event-bus';
import { getDatabase, closeDatabase } from '../database/connection';
import { initCacheSchema } from '../database/cache-schema';
import { JobScheduler } from '../services/scheduler';
import { EventBridge } from './event-bridge';
import { AutomationTriggerEvaluator } from '../services/automation-trigger';
import type { SdkClient } from '@leadforge/sdk';

import { telemetry } from './telemetry';
import { UpdateManager } from '../services/updater';
import { updateSplashProgress } from './splash-window';

import { CacheHydrator } from '../services/cache-hydrator';

/**
 * WorkspaceRuntime manages a single workspace isolated connection, local event bus,
 * and lifecycle engines (scheduler, cache hydrator, etc.).
 */
export class WorkspaceRuntime {
  public readonly workspaceId: string;
  public readonly sqliteDb: Database.Database;
  public readonly eventBus: LocalEventBus;
  public readonly scheduler: JobScheduler;
  public readonly eventBridge: EventBridge;
  public readonly triggerEvaluator: AutomationTriggerEvaluator;
  public readonly sdk: SdkClient;
  private isRunning: boolean = false;

  public startedAt: Date | null = null;
  public startupStartedAt: Date | null = null;
  public startupCompletedAt: Date | null = null;
  public startupDuration: number = 0;
  public lastRestart: Date | null = null;

  public databaseOpenDuration: number = 0;
  public migrationsDuration: number = 0;
  public schedulerDuration: number = 0;
  public cacheHydrationDuration: number = 0;
  public automationDuration: number = 0;

  private static restartCounts = new Map<string, number>();

  public get restartCount(): number {
    return WorkspaceRuntime.restartCounts.get(this.workspaceId) || 0;
  }

  constructor(workspaceId: string, sdk: SdkClient) {
    this.workspaceId = workspaceId;
    this.sdk = sdk;
    const dbOpenStart = Date.now();
    this.sqliteDb = getDatabase(workspaceId);
    this.databaseOpenDuration = Date.now() - dbOpenStart;

    // Ensure clean disposable cache schema is initialized eagerly — before constructing any service
    // that pre-compiles SQL prepared statements (e.g. AutomationTriggerEvaluator compiles SELECT FROM sequences
    // in its constructor, which crashes on a brand-new database with no tables yet).
    initCacheSchema(this.sqliteDb);

    this.eventBus = new LocalEventBus(workspaceId);
    this.scheduler = new JobScheduler(workspaceId, this.sdk, this.eventBus);
    try {
      UpdateManager.getInstance().registerScheduler(this.scheduler);
    } catch {}
    this.eventBridge = new EventBridge(this.eventBus);
    this.triggerEvaluator = new AutomationTriggerEvaluator(
      workspaceId,
      this.sqliteDb,
      this.eventBus,
      this.sdk
    );
  }

  /**
   * Initializes workspace-scoped database tables and starts background engines.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;

    this.startupStartedAt = new Date();
    this.lastRestart = this.startupStartedAt;

    // Increment restart count
    const prevCount = WorkspaceRuntime.restartCounts.get(this.workspaceId) || 0;
    WorkspaceRuntime.restartCounts.set(this.workspaceId, prevCount + 1);

    this.startedAt = new Date();

    console.log(`[WorkspaceRuntime] Starting workspace runtime: ${this.workspaceId}`);

    // Broadcast progress helper
    const sendBootProgress = (step: string, label: string) => {
      try {
        updateSplashProgress(step, label);
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send('workspace:boot-progress', { step, label });
          }
        });
      } catch (err) {
        // Ignore
      }
    };

    sendBootProgress('database:open', '✓ Opening database');

    // 1. Initialize clean cache schema
    sendBootProgress('database:cache-schema', '✓ Initializing cache schema');
    const schemaStart = Date.now();
    try {
      initCacheSchema(this.sqliteDb);
    } catch (err) {
      console.error(
        `[WorkspaceRuntime] Database cache schema initialization failed for workspace ${this.workspaceId}:`,
        err
      );
      throw err;
    }
    this.migrationsDuration = Date.now() - schemaStart;

    // 2. Recover interrupted background jobs and waiting sequences before scheduler starts
    await this.recoverInterruptedJobs();

    // 3. Start Concurrency Scheduler with MongoDB-backed policy
    sendBootProgress('scheduler:start', '✓ Starting scheduler');
    const schedStart = Date.now();
    try {
      const policy = await this.sdk.workspaces.getSchedulerPolicy(this.workspaceId);
      if (policy) {
        this.scheduler.setPolicy(policy);
      }
    } catch (err: any) {
      console.warn(
        `[WorkspaceRuntime] Could not load scheduler policy from MongoDB for ${this.workspaceId}, using canonical default:`,
        err?.message || err
      );
    }
    await this.scheduler.start();
    this.schedulerDuration = Date.now() - schedStart;

    // 4. Trigger Workspace Cache Hydration from MongoDB
    sendBootProgress('cache:hydrate', '✓ Hydrating local cache from MongoDB');
    const hydrateStart = Date.now();
    try {
      await CacheHydrator.hydrateWorkspaceCache(this.workspaceId, this.sdk);
    } catch (err) {
      console.warn(`[WorkspaceRuntime] Workspace cache hydration error: ${err}`);
    }
    this.cacheHydrationDuration = Date.now() - hydrateStart;

    // 5. Start EventBridge to forward LocalEventBus events to the renderer process
    this.eventBridge.start();

    // 6. Start AutomationTriggerEvaluator to listen for CRM/job events and queue automation workflows
    sendBootProgress('automation:start', '✓ Starting automation runtime');
    const autoStart = Date.now();
    this.triggerEvaluator.start();
    this.automationDuration = Date.now() - autoStart;

    this.isRunning = true;
    this.startupCompletedAt = new Date();
    this.startupDuration = this.startupCompletedAt.getTime() - this.startupStartedAt.getTime();

    // Update global telemetry with these workspace durations
    telemetry.databaseOpenDuration = this.databaseOpenDuration;
    telemetry.migrationsDuration = this.migrationsDuration;
    telemetry.schedulerDuration = this.schedulerDuration;
    telemetry.automationDuration = this.automationDuration;

    telemetry.saveAnalyticsMetricsLocal(this.workspaceId);

    console.log(`[WorkspaceRuntime] Workspace runtime "${this.workspaceId}" successfully booted.`);
    sendBootProgress('ready', '✓ Ready');
  }

  /**
   * Shuts down background polling, closes database file lock cleanly.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log(`[WorkspaceRuntime] Stopping workspace runtime: ${this.workspaceId}`);

    // 1. Stop Concurrency Scheduler
    await this.scheduler.stop();

    // 2. Stop EventBridge event forwarding to prevent memory leaks
    this.eventBridge.stop();

    // 3. Stop AutomationTriggerEvaluator before clearing the event bus
    this.triggerEvaluator.stop();

    // 4. Clear event bus listeners
    this.eventBus.clear();

    // 5. Close SQLite file handle pool connection
    closeDatabase(this.workspaceId);

    this.isRunning = false;
    console.log(`[WorkspaceRuntime] Workspace runtime "${this.workspaceId}" stopped cleanly.`);
  }

  /**
   * Recovers jobs that were left in starting/running state due to an unexpected shutdown/crash.
   */
  private async recoverInterruptedJobs(): Promise<void> {
    try {
      console.log(`[WorkspaceRuntime] Recovering interrupted jobs for workspace: ${this.workspaceId}`);
      await this.sdk.jobs.recover(0);
    } catch (err) {
      console.warn(`[WorkspaceRuntime] Interrupted job recovery warning for ${this.workspaceId}:`, err);
    }
  }
}
