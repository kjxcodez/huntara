import { describe, it, expect } from 'vitest';
import { ToolDispatcher } from '../tool-invocation/tool-dispatcher';
import { ConsoleInvocationLogger } from '../tool-invocation/invocation-logger';
import type { ToolRequest } from '../tool-invocation/types';
import { ToolRegistry } from '@huntara/agent-core';
import type { Tool, ToolResult, ExecutionContext } from '@huntara/agent-core';
import { z } from 'zod';

const EXEC_CTX: ExecutionContext = {
  workspaceId: 'ws-test',
  executionId: 'exec-test',
  traceId: 'trace-test',
  actorId: 'user-test',
  actorType: 'user',
  requestedBy: 'test',
  permissions: [],
  executionMode: 'offline'
};

const mockValidTool: Tool = {
  name: 'mock_valid',
  description: 'Valid tool',
  inputSchema: z.object({ value: z.string() }),
  riskLevel: 'LOW',
  execute: async (input: any, ctx: ExecutionContext): Promise<ToolResult> => ({
    success: true,
    data: { echoed: input.value },
    metadata: {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 1,
      attempt: 1,
      workspaceId: ctx.workspaceId,
      traceId: ctx.traceId,
      cached: false,
      retryCount: 0
    }
  })
};

const mockApprovalTool: Tool = {
  name: 'mock_approval_required',
  description: 'Approval tool',
  inputSchema: z.object({}),
  riskLevel: 'HIGH',
  schema: {
    description: 'Approval tool schema',
    inputSchema: z.object({}),
    examples: [],
    requiresApproval: true,
    approvalReason: 'Sensitive action'
  },
  execute: async (_input: any, ctx: ExecutionContext): Promise<ToolResult> => ({
    success: true,
    data: 'approved success',
    metadata: {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 1,
      attempt: 1,
      workspaceId: ctx.workspaceId,
      traceId: ctx.traceId,
      cached: false,
      retryCount: 0
    }
  })
};

describe('ToolDispatcher', () => {
  it('successfully dispatches tool, parses inputs, returns outputs and logs execution', async () => {
    const registry = new ToolRegistry();
    registry.register(mockValidTool);

    const logger = new ConsoleInvocationLogger();
    const dispatcher = new ToolDispatcher(registry, logger);

    const req: ToolRequest = {
      requestId: 'req-1',
      toolName: 'mock_valid',
      arguments: { value: 'hello' },
      traceId: 'trace-test',
      workspaceId: 'ws-test',
      invokedBy: 'test-step',
      timestamp: new Date().toISOString(),
      requiresApproval: false
    };

    const res = await dispatcher.dispatch(req, EXEC_CTX);

    expect(res.success).toBe(true);
    expect(res.approvalStatus).toBe('NOT_REQUIRED');
    expect(res.data).toEqual({ echoed: 'hello' });
    expect(res.toolResult).toBeDefined();
    expect(logger.getLogs().length).toBe(1);
  });

  it('returns structured UNAVAILABLE error when tool is not found', async () => {
    const registry = new ToolRegistry();
    const logger = new ConsoleInvocationLogger();
    const dispatcher = new ToolDispatcher(registry, logger);

    const req: ToolRequest = {
      requestId: 'req-2',
      toolName: 'non_existent_tool',
      arguments: {},
      traceId: 'trace-test',
      workspaceId: 'ws-test',
      invokedBy: 'test-step',
      timestamp: new Date().toISOString(),
      requiresApproval: false
    };

    const res = await dispatcher.dispatch(req, EXEC_CTX);

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('UNAVAILABLE');
    expect(res.error?.message).toContain('not found');
    expect(logger.getLogs().length).toBe(1);
  });

  it('rejects invalid inputs prior to run with VALIDATION_ERROR', async () => {
    const registry = new ToolRegistry();
    registry.register(mockValidTool);

    const logger = new ConsoleInvocationLogger();
    const dispatcher = new ToolDispatcher(registry, logger);

    const req: ToolRequest = {
      requestId: 'req-3',
      toolName: 'mock_valid',
      arguments: { value: 123 }, // Expected string, sent number
      traceId: 'trace-test',
      workspaceId: 'ws-test',
      invokedBy: 'test-step',
      timestamp: new Date().toISOString(),
      requiresApproval: false
    };

    const res = await dispatcher.dispatch(req, EXEC_CTX);

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
  });

  it('stops execution and flags PENDING status when APPROVAL_REQUIRED', async () => {
    const registry = new ToolRegistry();
    registry.register(mockApprovalTool);

    const logger = new ConsoleInvocationLogger();
    const dispatcher = new ToolDispatcher(registry, logger);

    const req: ToolRequest = {
      requestId: 'req-4',
      toolName: 'mock_approval_required',
      arguments: {},
      traceId: 'trace-test',
      workspaceId: 'ws-test',
      invokedBy: 'test-step',
      timestamp: new Date().toISOString(),
      requiresApproval: true
    };

    const res = await dispatcher.dispatch(req, EXEC_CTX);

    expect(res.success).toBe(false);
    expect(res.approvalStatus).toBe('PENDING');
    expect(res.error?.code).toBe('APPROVAL_REQUIRED');
  });
});
