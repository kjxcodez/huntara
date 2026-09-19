/**
 * Agent Runtime & ResearchAgent Delegation Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { AgentRuntime, ResearchAgent } from '../index.js';
import { ToolRegistry } from '@huntara/agent-core';
import type { Tool, ToolResult, ExecutionContext } from '@huntara/agent-core';
import { z } from 'zod';

const mockSearchTool: Tool = {
  name: 'search_local_businesses',
  description: 'Mock search businesses',
  inputSchema: z.object({ query: z.string(), limit: z.number().optional() }),
  riskLevel: 'LOW',
  execute: async (_input: any, context: ExecutionContext): Promise<ToolResult> => ({
    success: true,
    data: [
      { id: 'c-1', name: 'Mock Company 1', domain: 'mock1.com' },
      { id: 'c-2', name: 'Mock Company 2', domain: 'mock2.com' }
    ],
    metadata: {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 2,
      attempt: 1,
      workspaceId: context.workspaceId,
      traceId: context.traceId,
      cached: false,
      retryCount: 0
    }
  })
};

const mockCrawlTool: Tool = {
  name: 'crawl_company_website',
  description: 'Mock website crawler',
  inputSchema: z.object({ companyId: z.string(), domain: z.string() }),
  riskLevel: 'LOW',
  execute: async (input: any, context: ExecutionContext): Promise<ToolResult> => ({
    success: true,
    data: {
      emails: [`info@${input.domain}`],
      phone: '123-456'
    },
    metadata: {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 3,
      attempt: 1,
      workspaceId: context.workspaceId,
      traceId: context.traceId,
      cached: false,
      retryCount: 0
    }
  })
};

describe('AgentRuntime Suite', () => {
  it('executes ResearchAgent with state transitions and tool result collection', async () => {
    const registry = new ToolRegistry();
    registry.register(mockSearchTool);
    registry.register(mockCrawlTool);

    const runtime = new AgentRuntime(registry, { aiMode: 'mock' });

    const statesEmitted: string[] = [];
    runtime.subscribe((session) => {
      statesEmitted.push(session.getState());
    });

    const response = await runtime.execute(ResearchAgent, 'Austin software companies', {
      workspaceId: 'ws-test',
      executionId: 'exec-test',
      traceId: 'trace-test',
      actorId: 'user-test'
    });

    expect(response.success).toBe(true);
    expect(response.message.length).toBeGreaterThan(0);
    expect(statesEmitted).toContain('PREPARING_CONTEXT');
    expect(statesEmitted).toContain('EXECUTING_TOOL');
    expect(statesEmitted).toContain('RECEIVING_TOOL_RESULT');
    expect(statesEmitted).toContain('COMPLETED');
    expect(response.toolsExecuted.length).toBeGreaterThanOrEqual(1);
  });
});
