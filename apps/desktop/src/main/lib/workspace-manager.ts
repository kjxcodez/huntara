import { WorkspaceRuntime } from './workspace-runtime';
import type { SdkClient } from '@huntara/sdk';
import { telemetry } from './telemetry';

/**
 * WorkspaceManager acts as the Main process runtime supervisor, managing the active
 * workspace instance lifecycle.
 */
class WorkspaceManagerClass {
  private activeRuntime: WorkspaceRuntime | null = null;
  private sdk: SdkClient | null = null;
  private totalStarts: number = 0;
  private totalShutdowns: number = 0;
  private totalStartupDuration: number = 0;
  private previousRuntimeId: string | null = null;
  private lastFailureMessage: string | null = null;
  private transitionPromise: Promise<WorkspaceRuntime | null> | null = null;
  private targetWorkspaceId: string | null = null;

  public setSdk(sdk: SdkClient): void {
    this.sdk = sdk;
  }

  public getSdk(workspaceId?: string): SdkClient {
    if (workspaceId && this.activeRuntime && this.activeRuntime.workspaceId === workspaceId && this.activeRuntime.sdk) {
      return this.activeRuntime.sdk;
    }
    if (!this.sdk) throw new Error('SDK client has not been set in WorkspaceManager.');
    return this.sdk;
  }

  /**
   * Switches the active workspace, spinning down the previous runtime and booting the new one.
   * Serializes transitions to ensure zero duplicate runtime instances or race conditions.
   */
  public async setActiveWorkspace(workspaceId: string | null): Promise<WorkspaceRuntime | null> {
    if (this.activeRuntime && this.activeRuntime.workspaceId === workspaceId && !this.transitionPromise) {
      console.log(
        `[WorkspaceManager] Workspace ${workspaceId} is already active, skipping restart.`
      );
      return this.activeRuntime;
    }

    if (this.transitionPromise) {
      if (this.targetWorkspaceId === workspaceId) {
        console.log(`[WorkspaceManager] Workspace transition to ${workspaceId} already in progress, awaiting.`);
        return this.transitionPromise;
      }
      // A different workspace transition is in flight, await it before proceeding
      try {
        await this.transitionPromise;
      } catch {}
      if (this.activeRuntime && this.activeRuntime.workspaceId === workspaceId) {
        return this.activeRuntime;
      }
    }

    this.targetWorkspaceId = workspaceId;
    this.transitionPromise = (async () => {
      // 1. Cleanly spin down current runtime if running
      if (this.activeRuntime) {
        console.log(
          `[WorkspaceManager] Spinning down active workspace: ${this.activeRuntime.workspaceId}`
        );
        this.previousRuntimeId = this.activeRuntime.workspaceId;
        await this.activeRuntime.stop();
        this.activeRuntime = null;
        this.totalShutdowns++;
      }

      if (!workspaceId) {
        console.log('[WorkspaceManager] Active workspace cleared.');
        return null;
      }

      console.log(`[WorkspaceManager] Swapping active workspace runtime to: ${workspaceId}`);

      // 2. Initialize new isolated runtime environment
      const runtime = new WorkspaceRuntime(workspaceId, this.getSdk());
      const activateStart = Date.now();
      try {
        await runtime.start();

        const activateDuration = Date.now() - activateStart;
        this.totalStarts++;
        this.totalStartupDuration += activateDuration;

        telemetry.workspaceActivationDuration = activateDuration;

        this.activeRuntime = runtime;
        this.lastFailureMessage = null;
        return runtime;
      } catch (err: any) {
        this.lastFailureMessage = err.message || String(err);
        console.error(
          `[WorkspaceManager] Failed to start runtime for workspace ${workspaceId}:`,
          err
        );
        // Ensure we don't leave a semi-initialized runtime active
        await runtime.stop().catch(() => {});
        this.activeRuntime = null;
        throw err;
      }
    })();

    try {
      return await this.transitionPromise;
    } finally {
      this.transitionPromise = null;
      this.targetWorkspaceId = null;
    }
  }

  /**
   * Retrieves the currently active WorkspaceRuntime, awaiting any in-flight transitions
   * or eagerly activating the target workspace if provided and not yet active.
   */
  public async getOrAwaitActiveRuntime(
    workspaceId?: string | null
  ): Promise<WorkspaceRuntime | null> {
    if (this.transitionPromise) {
      try {
        await this.transitionPromise;
      } catch (err) {
        console.warn('[WorkspaceManager] In-flight workspace transition threw:', err);
      }
    }

    if (this.activeRuntime) {
      if (!workspaceId || this.activeRuntime.workspaceId === workspaceId) {
        return this.activeRuntime;
      }
    }

    if (workspaceId) {
      try {
        return await this.setActiveWorkspace(workspaceId);
      } catch (err) {
        console.error(`[WorkspaceManager] Failed to eagerly activate workspace ${workspaceId}:`, err);
        return null;
      }
    }

    return this.activeRuntime;
  }

  /**
   * Retrieves the currently active WorkspaceRuntime synchronously.
   */
  public getActiveRuntime(): WorkspaceRuntime | null {
    return this.activeRuntime;
  }

  /**
   * Retrieves the target workspace ID currently being transitioned to or active.
   */
  public getTargetWorkspaceId(): string | null {
    return this.targetWorkspaceId || (this.activeRuntime?.workspaceId ?? null);
  }

  /**
   * Retrieves the JobScheduler for the currently active runtime.
   */
  public getScheduler(): any | null {
    return this.activeRuntime ? this.activeRuntime.scheduler : null;
  }

  /**
   * Wakes up the active scheduler immediately on newly submitted jobs.
   */
  public wakeScheduler(): void {
    if (this.activeRuntime && this.activeRuntime.scheduler) {
      this.activeRuntime.scheduler.wakeUp();
    }
  }

  /**
   * Returns aggregated lifecycle metrics of the workspace manager runtime.
   */
  public getLifecycleMetrics() {
    return {
      totalStarts: this.totalStarts,
      totalShutdowns: this.totalShutdowns,
      averageStartupTime: this.totalStarts > 0 ? this.totalStartupDuration / this.totalStarts : 0,
      currentActiveRuntimeId: this.activeRuntime?.workspaceId || null,
      previousRuntimeId: this.previousRuntimeId,
      lastFailure: this.lastFailureMessage
    };
  }
}

export const WorkspaceManager = new WorkspaceManagerClass();
