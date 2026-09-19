import type { ToolRegistry, ToolResult, ExecutionContext } from '@huntara/agent-core';

export class ToolExecutor {
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  /**
   * Resolves a tool from the registry and executes it under the provided context.
   */
  public async executeTool(
    toolName: string,
    input: unknown,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const tool = this.registry.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: {
          code: 'UNAVAILABLE',
          message: `Tool "${toolName}" not found in registry.`,
          isRetryable: false
        },
        metadata: {
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
          attempt: 1,
          workspaceId: context.workspaceId,
          traceId: context.traceId,
          cached: false,
          retryCount: 0
        }
      };
    }

    try {
      return await tool.execute(input, context);
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: 'WORKER_ERROR',
          message: err.message || 'Tool execution uncaught error',
          isRetryable: true
        },
        metadata: {
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
          attempt: 1,
          workspaceId: context.workspaceId,
          traceId: context.traceId,
          cached: false,
          retryCount: 0
        }
      };
    }
  }
}
