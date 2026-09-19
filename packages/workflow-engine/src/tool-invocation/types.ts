import type { ToolError, ToolResult } from '@huntara/agent-core';

export interface ToolRequest {
  readonly requestId: string; // UUID per invocation
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  readonly traceId: string;
  readonly workspaceId: string;
  readonly invokedBy: string; // step ID that triggered this
  readonly timestamp: string;
  readonly requiresApproval: boolean;
}

export interface ToolResponse<T = unknown> {
  readonly requestId: string;
  readonly toolName: string;
  readonly success: boolean;
  readonly data?: T | undefined;
  readonly error?: ToolError | undefined;
  readonly approvalStatus: 'NOT_REQUIRED' | 'GRANTED' | 'PENDING' | 'REJECTED';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly traceId: string;
  readonly toolResult?: ToolResult<T> | undefined;
}

export interface ToolInvocationLog {
  readonly requestId: string;
  readonly toolName: string;
  readonly traceId: string;
  readonly workspaceId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly validationPassed: boolean;
  readonly approvalStatus: ToolResponse['approvalStatus'];
  readonly errorCode?: string | undefined;
}

export interface ToolValidationResult {
  readonly valid: boolean;
  readonly errors?: string[] | undefined;
}
