/**
 * IPC Protocol Types — HUNTARA Worker Runtime
 *
 * Defines the typed message contracts between the Electron Main process
 * and forked Node.js worker child processes.
 *
 * Spec: worker_runtime_spec.md §4.2
 */

/**
 * Messages sent FROM the Main process TO a Worker child process.
 *
 * The discriminant field is `command`.
 */
export type MainToWorkerMsg =
  /** Instructs the worker to begin executing a job. Always the first command. */
  | { command: 'start'; jobId: string; workspaceId: string; type: string; payload: any }
  /** Soft cancel request — worker should clean up and exit with code 0. */
  | { command: 'cancel' }
  /** Soft pause request — worker should save a checkpoint and exit with code 0. */
  | { command: 'pause' }
  /** Resume signal — sent when a paused job is re-dispatched (informational in this release). */
  | { command: 'resume' }
  /** Heartbeat liveness check — worker must respond with { type: 'pong' }. */
  | { command: 'ping' };

/**
 * Messages sent FROM a Worker child process TO the Main process.
 *
 * The discriminant field is `type`.
 */
export type WorkerToMainMsg =
  /** Worker process has initialised and is ready to accept the 'start' command. */
  | { type: 'ready' }
  /** Job progress update. `progress` is 0–100. */
  | { type: 'progress'; progress: number; metadata?: any; checkpoint?: any }
  /** Structured log entry from within the worker. */
  | { type: 'log'; severity: 'info' | 'warn' | 'error'; message: string; meta?: any }
  /** Resumable state snapshot saved by the plugin via ctx.saveCheckpoint(). */
  | { type: 'checkpoint'; data: any }
  /** Heartbeat response to a 'ping' command. */
  | { type: 'pong'; timestamp: string }
  /** Worker has paused — checkpoint data attached, process is exiting with code 0. */
  | { type: 'paused'; checkpoint: any }
  /** Graceful cancel complete — worker cleaned up, process is exiting with code 0. */
  | { type: 'cancelled'; cleanedUp: boolean }
  /** Job completed successfully. */
  | { type: 'success'; result: any }
  /** Job failed. `recoverable` indicates whether a retry is worthwhile. */
  | { type: 'error'; error: string; recoverable: boolean };
