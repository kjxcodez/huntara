import type { ToolResult } from '@huntara/agent-core';

export type AgentLifecycleState =
  | 'CREATED'
  | 'PREPARING_CONTEXT'
  | 'CALLING_LLM'
  | 'EXECUTING_TOOL'
  | 'RECEIVING_TOOL_RESULT'
  | 'GENERATING_RESPONSE'
  | 'COMPLETED'
  | 'FAILED';

export interface AgentLifecycleEvent {
  readonly state: AgentLifecycleState;
  readonly timestamp: string;
  readonly traceId: string;
  readonly message?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface AgentResponse<T = unknown> {
  readonly success: boolean;
  readonly data?: T | undefined;
  readonly message: string;
  readonly traceId: string;
  readonly toolsExecuted: Array<{
    readonly toolName: string;
    readonly result: ToolResult;
  }>;
  readonly metadata: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly durationMs: number;
    readonly stepsCount: number;
  };
}
