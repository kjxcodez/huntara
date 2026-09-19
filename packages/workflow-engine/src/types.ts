import type { ToolResult } from '@huntara/agent-core';

// ─── Step Status ────────────────────────────────────────────────────────────

export type WorkflowStepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

// ─── Workflow Status ─────────────────────────────────────────────────────────

export type WorkflowStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

// ─── Step Result ─────────────────────────────────────────────────────────────

export interface WorkflowStepResult<T = unknown> {
  readonly stepId: string;
  readonly stepName: string;
  readonly status: WorkflowStepStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  /** Populated on successful ToolStep executions. */
  readonly toolResults?: ToolResult<T>[] | undefined;
  /** Populated on successful LLMStep or TransformStep executions. */
  readonly output?: T | undefined;
  /** Populated on failure. */
  readonly error?: string | undefined;
}

// ─── Workflow Result ─────────────────────────────────────────────────────────

export interface WorkflowResult<TOutput = unknown> {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly traceId: string;
  readonly status: WorkflowStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly steps: WorkflowStepResult[];
  /** Final output produced by the last step of the workflow. */
  readonly output?: TOutput | undefined;
  readonly error?: string | undefined;
}
