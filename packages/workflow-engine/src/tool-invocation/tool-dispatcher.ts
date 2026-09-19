import type { ToolRegistry, ExecutionContext, ToolResult } from '@huntara/agent-core';
import type { ToolRequest, ToolResponse, ToolInvocationLog } from './types';
import type { InvocationLogger } from './invocation-logger';
import { ConsoleInvocationLogger } from './invocation-logger';

export class ToolDispatcher {
  private readonly registry: ToolRegistry;
  private readonly logger: InvocationLogger;

  constructor(registry: ToolRegistry, logger: InvocationLogger = new ConsoleInvocationLogger()) {
    this.registry = registry;
    this.logger = logger;
  }

  /**
   * Checks if the specified tool requires human approval.
   */
  public toolRequiresApproval(toolName: string): boolean {
    const tool = this.registry.get(toolName);
    if (!tool) return false;
    return tool.schema?.requiresApproval ?? tool.riskLevel === 'HIGH';
  }

  /**
   * Validates and dispatches a structured tool request.
   */
  public async dispatch<T>(
    request: ToolRequest,
    execCtx: ExecutionContext
  ): Promise<ToolResponse<T>> {
    const startedAt = new Date().toISOString();
    const startTimeMs = Date.now();

    this.logger.logRequest(request);

    // 1. Resolve Tool
    const tool = this.registry.get(request.toolName);
    if (!tool) {
      const durationMs = Date.now() - startTimeMs;
      const response: ToolResponse<T> = {
        requestId: request.requestId,
        toolName: request.toolName,
        success: false,
        error: {
          code: 'UNAVAILABLE',
          message: `Tool "${request.toolName}" was not found in ToolRegistry.`,
          isRetryable: false
        },
        approvalStatus: 'NOT_REQUIRED',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs,
        traceId: request.traceId
      };

      const log: ToolInvocationLog = {
        requestId: request.requestId,
        toolName: request.toolName,
        traceId: request.traceId,
        workspaceId: request.workspaceId,
        startedAt,
        completedAt: response.completedAt,
        durationMs,
        success: false,
        validationPassed: false,
        approvalStatus: 'NOT_REQUIRED',
        errorCode: 'UNAVAILABLE'
      };

      this.logger.logResponse(response, log);
      return response;
    }

    // 2. Validate input schema using Zod
    const schema = tool.schema?.inputSchema ?? tool.inputSchema;
    const parsed = schema.safeParse(request.arguments);
    if (!parsed.success) {
      const durationMs = Date.now() - startTimeMs;
      const validationErrorMsg = parsed.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join(', ');
      const response: ToolResponse<T> = {
        requestId: request.requestId,
        toolName: request.toolName,
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Validation failed: ${validationErrorMsg}`,
          isRetryable: false
        },
        approvalStatus: 'NOT_REQUIRED',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs,
        traceId: request.traceId
      };

      const log: ToolInvocationLog = {
        requestId: request.requestId,
        toolName: request.toolName,
        traceId: request.traceId,
        workspaceId: request.workspaceId,
        startedAt,
        completedAt: response.completedAt,
        durationMs,
        success: false,
        validationPassed: false,
        approvalStatus: 'NOT_REQUIRED',
        errorCode: 'VALIDATION_ERROR'
      };

      this.logger.logResponse(response, log);
      return response;
    }

    // 3. Human Approval check
    const requiresApproval = tool.schema?.requiresApproval ?? tool.riskLevel === 'HIGH';
    if (requiresApproval && request.requiresApproval) {
      const durationMs = Date.now() - startTimeMs;
      const response: ToolResponse<T> = {
        requestId: request.requestId,
        toolName: request.toolName,
        success: false,
        error: {
          code: 'APPROVAL_REQUIRED',
          message: `Tool "${request.toolName}" requires human approval before execution.`,
          isRetryable: false
        },
        approvalStatus: 'PENDING',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs,
        traceId: request.traceId
      };

      const log: ToolInvocationLog = {
        requestId: request.requestId,
        toolName: request.toolName,
        traceId: request.traceId,
        workspaceId: request.workspaceId,
        startedAt,
        completedAt: response.completedAt,
        durationMs,
        success: false,
        validationPassed: true,
        approvalStatus: 'PENDING',
        errorCode: 'APPROVAL_REQUIRED'
      };

      this.logger.logResponse(response, log);
      return response;
    }

    // 4. Tool Execution
    try {
      const result: ToolResult<T> = (await tool.execute(parsed.data as any, execCtx)) as any;
      const durationMs = Date.now() - startTimeMs;
      const completedAt = new Date().toISOString();

      const approvalStatus = requiresApproval ? 'GRANTED' : 'NOT_REQUIRED';

      if (result.success) {
        const response: ToolResponse<T> = {
          requestId: request.requestId,
          toolName: request.toolName,
          success: true,
          data: result.data,
          approvalStatus,
          startedAt,
          completedAt,
          durationMs,
          traceId: request.traceId,
          toolResult: result
        };

        const log: ToolInvocationLog = {
          requestId: request.requestId,
          toolName: request.toolName,
          traceId: request.traceId,
          workspaceId: request.workspaceId,
          startedAt,
          completedAt,
          durationMs,
          success: true,
          validationPassed: true,
          approvalStatus
        };

        this.logger.logResponse(response, log);
        return response;
      } else {
        const response: ToolResponse<T> = {
          requestId: request.requestId,
          toolName: request.toolName,
          success: false,
          error: result.error,
          approvalStatus,
          startedAt,
          completedAt,
          durationMs,
          traceId: request.traceId,
          toolResult: result
        };

        const log: ToolInvocationLog = {
          requestId: request.requestId,
          toolName: request.toolName,
          traceId: request.traceId,
          workspaceId: request.workspaceId,
          startedAt,
          completedAt,
          durationMs,
          success: false,
          validationPassed: true,
          approvalStatus,
          errorCode: result.error?.code ?? 'UNKNOWN'
        };

        this.logger.logResponse(response, log);
        return response;
      }
    } catch (err: any) {
      const durationMs = Date.now() - startTimeMs;
      const completedAt = new Date().toISOString();
      const approvalStatus = requiresApproval ? 'GRANTED' : 'NOT_REQUIRED';

      const response: ToolResponse<T> = {
        requestId: request.requestId,
        toolName: request.toolName,
        success: false,
        error: {
          code: 'WORKER_ERROR',
          message: err.message || 'Tool execution uncaught error',
          isRetryable: true
        },
        approvalStatus,
        startedAt,
        completedAt,
        durationMs,
        traceId: request.traceId
      };

      const log: ToolInvocationLog = {
        requestId: request.requestId,
        toolName: request.toolName,
        traceId: request.traceId,
        workspaceId: request.workspaceId,
        startedAt,
        completedAt,
        durationMs,
        success: false,
        validationPassed: true,
        approvalStatus,
        errorCode: 'WORKER_ERROR'
      };

      this.logger.logResponse(response, log);
      return response;
    }
  }
}
