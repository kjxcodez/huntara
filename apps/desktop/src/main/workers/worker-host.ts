import { join } from 'path';
import { existsSync } from 'fs';
import type { MainToWorkerMsg, WorkerToMainMsg } from '../../shared/types/ipc';
import type { JobContext } from '../../shared/types/job';
import { WorkerPluginRegistry } from './plugin-registry';
import { scrapeMaps } from './plugins/scraper';
import { crawlWebsite } from './plugins/crawler';
import { enrichWebsite } from './plugins/enricher';
import { dispatchOutreach } from './plugins/outreach';
import { executeAutomationWorkflow } from './plugins/automation';
import { enrichLinkedIn } from './plugins/linkedin';
import { pollImapReplies } from './plugins/imap-poller';
import { executeIntelligenceEnrichment } from './plugins/intelligence-worker';

export { resolveWorkerApiUrl } from './worker-env';

// ---------------------------------------------------------------------------
// Mock Test Plugin
// ---------------------------------------------------------------------------

/**
 * Mock test job plugin that simulates slow progress.
 * Used for integration testing of the IPC protocol without real I/O.
 */
async function mockTest(ctx: JobContext): Promise<any> {
  ctx.emitLog('Starting mock test execution', 'info');
  for (let i = 1; i <= 10; i++) {
    if (ctx.isCancelled()) {
      ctx.emitLog('Mock test execution cancelled.', 'warn');
      throw new Error('Job cancelled.');
    }
    if (ctx.isPaused()) {
      ctx.emitLog('Mock test execution pausing.', 'warn');
      ctx.saveCheckpoint({ step: i });
      throw new Error('Job paused.');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    ctx.updateProgress(i * 10, { step: i, description: `Running test stage ${i} of 10` });
    ctx.emitLog(`Mock stage ${i} completed successfully.`, 'info');
  }
  ctx.emitLog('Mock test execution completed successfully.', 'info');
  return { status: 'success', stagesRun: 10 };
}

// ---------------------------------------------------------------------------
// Plugin Registry
// ---------------------------------------------------------------------------

/**
 * The global plugin registry for this worker process.
 * Plugins are registered once at startup and resolved by type string at job dispatch.
 * Spec: worker_runtime_spec.md §4.6
 */
const registry = new WorkerPluginRegistry();
registry.register('scraper:maps', scrapeMaps);
registry.register('crawler:website', crawlWebsite);
registry.register('enrich:website', enrichWebsite);
registry.register('enrich:linkedin', enrichLinkedIn);
registry.register('enrich:intelligence', executeIntelligenceEnrichment);
registry.register('outreach:campaign', dispatchOutreach);
registry.register('automation:workflow', executeAutomationWorkflow);
registry.register('outreach:imap-poll', pollImapReplies);
registry.register('mock:test', mockTest);

// ---------------------------------------------------------------------------
// Worker State
// Module-level flags are visible across all async message handlers because
// Node.js is single-threaded. async/await defers execution between awaited
// operations, allowing new messages to be processed mid-job.
// ---------------------------------------------------------------------------

/** Set to true when Main sends { command: 'cancel' }. */
let isCancelledState = false;
/** Set to true when Main sends { command: 'pause' }; cleared on 'resume'. */
let isPausedState = false;
/** Tracks the most recent checkpoint data saved via ctx.saveCheckpoint(). */
let lastCheckpoint: any = null;

// ---------------------------------------------------------------------------
// Global Process Error & Disconnect Handlers
// Guarantees structured error propagation to Main and prevents orphan processes.
// ---------------------------------------------------------------------------

process.on('uncaughtException', (err: any) => {
  const errorMsg = err instanceof Error ? err.message : String(err);
  try {
    process.send?.({
      type: 'error',
      error: `Uncaught exception in worker: ${errorMsg}`,
      recoverable: false
    } as WorkerToMainMsg);
  } catch {}
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  const errorMsg = reason instanceof Error ? reason.message : String(reason);
  try {
    process.send?.({
      type: 'error',
      error: `Unhandled rejection in worker: ${errorMsg}`,
      recoverable: false
    } as WorkerToMainMsg);
  } catch {}
  process.exit(1);
});

process.on('disconnect', () => {
  // Parent Main process disconnected or terminated; exit immediately to prevent orphan zombie workers.
  process.exit(1);
});

// ---------------------------------------------------------------------------
// READY Handshake
// Send immediately on process initialisation — before the 'start' command.
// Main transitions the job from 'starting' to 'running' on receipt.
// Spec: worker_runtime_spec.md §4.2 / AC-002.1
// ---------------------------------------------------------------------------

process.send?.({ type: 'ready' } as WorkerToMainMsg);

// ---------------------------------------------------------------------------
// IPC Message Router
// Single unified handler for all MainToWorkerMsg commands.
// The switch executes synchronously for control commands and asynchronously
// for 'start'. Concurrent messages are handled naturally by the event loop.
// ---------------------------------------------------------------------------

process.on('message', async (rawMsg: unknown) => {
  const msg = rawMsg as MainToWorkerMsg;
  if (!msg || typeof msg !== 'object' || !('command' in msg)) return;

  switch (msg.command) {
    // -----------------------------------------------------------------------
    case 'start':
      await handleStart(msg);
      break;

    // -----------------------------------------------------------------------
    // CANCEL — set flag; plugin checks ctx.isCancelled() at each boundary.
    // Worker sends { type: 'cancelled' } and exits 0 after plugin unwinds.
    // Spec: worker_runtime_spec.md §3.3 / AC-004
    // -----------------------------------------------------------------------
    case 'cancel':
      isCancelledState = true;
      break;

    // -----------------------------------------------------------------------
    // PAUSE — set flag; plugin checks ctx.isPaused(), calls ctx.saveCheckpoint(),
    // then throws. Worker sends { type: 'paused', checkpoint } and exits 0.
    // Spec: worker_runtime_spec.md §4.2 / AC-005
    // -----------------------------------------------------------------------
    case 'pause':
      isPausedState = true;
      break;

    // -----------------------------------------------------------------------
    // RESUME — clear pause flag (informational in this release; the scheduler
    // re-dispatches a new worker process for resumed jobs).
    // -----------------------------------------------------------------------
    case 'resume':
      isPausedState = false;
      break;

    // -----------------------------------------------------------------------
    // PING — respond with pong immediately.
    // Spec: worker_runtime_spec.md §4.5 / AC-002.2
    // -----------------------------------------------------------------------
    case 'ping':
      process.send?.({
        type: 'pong',
        timestamp: new Date().toISOString()
      } as WorkerToMainMsg);
      break;
  }
});

// ---------------------------------------------------------------------------
// Job Execution
// ---------------------------------------------------------------------------

/**
 * Handles the 'start' command.
 *
 * Constructs the typed JobContext, resolves the plugin, executes it, and
 * reports the outcome back to the Main process via the appropriate IPC message.
 *
 * Exit paths:
 *   success  → { type: 'success', result }   → process.exit(0)
 *   pause    → { type: 'paused', checkpoint } → process.exit(0)
 *   cancel   → { type: 'cancelled', ... }    → process.exit(0)
 *   error    → { type: 'error', ... }        → process.exit(1)
 */
async function handleStart(msg: Extract<MainToWorkerMsg, { command: 'start' }>): Promise<void> {
  const { jobId, workspaceId, type, payload } = msg;

  // Resolve the workspace SQLite path from the environment variable injected
  // by JobScheduler at fork time. Workers must NOT import 'electron'.
  const dbDir = process.env.WORKSPACES_DB_DIR ?? '';
  const canonicalDbPath = join(dbDir, `huntara_${workspaceId}.db`);
  const legacyDbPath = join(dbDir, `leadforge_${workspaceId}.db`);
  const dbPath = existsSync(canonicalDbPath) ? canonicalDbPath : (existsSync(legacyDbPath) ? legacyDbPath : canonicalDbPath);

  const context: JobContext = {
    jobId,
    workspaceId,
    payload,
    dbPath,

    // -----------------------------------------------------------------------
    // Progress & logging
    // -----------------------------------------------------------------------

    updateProgress: (progress: number, metadata?: any) => {
      process.send?.({ type: 'progress', progress, metadata } as WorkerToMainMsg);
    },

    emitLog: (message: string, severity: 'info' | 'warn' | 'error' = 'info', meta?: any) => {
      process.send?.({ type: 'log', severity, message, meta } as WorkerToMainMsg);
    },

    // -----------------------------------------------------------------------
    // Control signals
    // -----------------------------------------------------------------------

    isCancelled: () => isCancelledState,
    isPaused: () => isPausedState,

    // -----------------------------------------------------------------------
    // Checkpointing
    // saveCheckpoint sends an immediate snapshot to Main (stored in SQLite)
    // AND records the latest checkpoint locally for the paused/interrupted
    // exit path below.
    // -----------------------------------------------------------------------

    saveCheckpoint: (data: any) => {
      lastCheckpoint = data;
      process.send?.({ type: 'checkpoint', data } as WorkerToMainMsg);
    },

    /**
     * Returns the checkpoint from the previous pause/interrupt, if any.
     * The scheduler injects it as `payload._checkpoint` when re-dispatching.
     */
    getCheckpoint: () => payload?._checkpoint ?? null
  };

  try {
    const pluginFn = registry.resolve(type);
    if (!pluginFn) {
      throw new Error(`Job type "${type}" is not registered in the Worker Host.`);
    }

    const result = await pluginFn(context);

    process.send?.({ type: 'success', result } as WorkerToMainMsg);
    process.exit(0);
  } catch (err: any) {
    // Determine exit path based on active control-signal state.
    // Priority: pause > cancel > genuine error.

    if (isPausedState) {
      process.send?.({
        type: 'paused',
        checkpoint: lastCheckpoint
      } as WorkerToMainMsg);
      process.exit(0);
      return;
    }

    if (isCancelledState) {
      process.send?.({
        type: 'cancelled',
        cleanedUp: true
      } as WorkerToMainMsg);
      process.exit(0);
      return;
    }

    process.send?.({
      type: 'error',
      error: err.message || String(err),
      recoverable: false
    } as WorkerToMainMsg);
    process.exit(1);
  }
}
