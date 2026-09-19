import type { ToolResult } from '@huntara/agent-core';
import type { AgentResponse } from './types';

export class ResponseAssembler {
  /**
   * Assembles the final structured output envelope for the execution session.
   */
  public static assemble<T = unknown>(params: {
    readonly success: boolean;
    readonly data?: T;
    readonly message: string;
    readonly traceId: string;
    readonly toolsExecuted: Array<{ readonly toolName: string; readonly result: ToolResult }>;
    readonly startedAt: string;
  }): AgentResponse<T> {
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - new Date(params.startedAt).getTime();

    const res: any = {
      success: params.success,
      message: params.message,
      traceId: params.traceId,
      toolsExecuted: params.toolsExecuted,
      metadata: {
        startedAt: params.startedAt,
        completedAt,
        durationMs,
        stepsCount: params.toolsExecuted.length + 1
      }
    };

    if (params.data !== undefined) {
      res.data = params.data;
    }

    return res as AgentResponse<T>;
  }
}
