import { describe, it, expect } from 'vitest';
import { WorkflowRunner, ToolDispatcher } from '../index';
import { WorkflowContext } from '../workflow-context';
import { WorkflowEvents } from '../workflow-events';
import type { Workflow } from '../workflow';
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

const mockSearchTool: Tool = {
  name: 'mock_search',
  description: 'Mock search',
  inputSchema: z.object({ query: z.string() }),
  riskLevel: 'LOW',
  execute: async (_input: any, ctx: ExecutionContext): Promise<ToolResult> => ({
    success: true,
    data: [
      { id: 'c-1', name: 'Acme Corp', domain: 'acme.com' },
      { id: 'c-2', name: 'Beta LLC', domain: 'beta.com' }
    ],
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

const mockCrawlTool: Tool = {
  name: 'mock_crawl',
  description: 'Mock crawl',
  inputSchema: z.object({ domain: z.string() }),
  riskLevel: 'LOW',
  execute: async (input: any, ctx: ExecutionContext): Promise<ToolResult> => ({
    success: true,
    data: { emails: [`info@${input.domain}`] },
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

const mockFailingTool: Tool = {
  name: 'mock_fail',
  description: 'Always fails',
  inputSchema: z.object({}),
  riskLevel: 'LOW',
  execute: async (): Promise<ToolResult> => {
    throw new Error('Simulated tool failure');
  }
};

describe('WorkflowRunner & WorkflowEngine', () => {
  it('seeds, gets, sets, and checks existence in WorkflowContext', () => {
    const ctx = new WorkflowContext({ query: 'test query' });
    expect(ctx.get('query')).toBe('test query');
    ctx.set('step_one', [1, 2, 3]);
    expect(ctx.get('step_one')).toEqual([1, 2, 3]);
    expect(ctx.has('step_one')).toBe(true);
    expect(ctx.has('missing')).toBe(false);
    expect(ctx.get('missing')).toBeUndefined();
  });

  it('subscribes and emits all five WorkflowEvents types correctly', () => {
    const events = new WorkflowEvents();
    const emitted: string[] = [];

    events.onStarted(() => emitted.push('started'));
    events.onStepStarted(() => emitted.push('step:started'));
    events.onStepCompleted(() => emitted.push('step:completed'));
    events.onCompleted(() => emitted.push('completed'));
    events.onFailed(() => emitted.push('failed'));

    events.emitStarted({
      workflowId: 'w',
      workflowName: 'W',
      traceId: 't',
      timestamp: '',
      totalSteps: 1
    });
    events.emitStepStarted({
      workflowId: 'w',
      stepId: 's',
      stepName: 'S',
      stepIndex: 0,
      totalSteps: 1,
      traceId: 't',
      timestamp: ''
    });
    events.emitStepCompleted({
      workflowId: 'w',
      stepId: 's',
      stepName: 'S',
      stepIndex: 0,
      totalSteps: 1,
      traceId: 't',
      timestamp: '',
      durationMs: 1
    });
    events.emitCompleted({
      workflowId: 'w',
      workflowName: 'W',
      traceId: 't',
      timestamp: '',
      durationMs: 1,
      stepsCompleted: 1
    });

    expect(emitted).toEqual(['started', 'step:started', 'step:completed', 'completed']);
  });

  it('executes steps in declaration order and emits all events', async () => {
    const registry = new ToolRegistry();
    registry.register(mockSearchTool);

    const stepsExecuted: string[] = [];

    const workflow: Workflow = {
      id: 'test_workflow',
      name: 'Test Workflow',
      description: 'Test',
      steps: [
        {
          type: 'ToolStep',
          id: 'step_a',
          name: 'Step A',
          toolName: 'mock_search',
          buildInput: () => ({ query: 'test' })
        },
        {
          type: 'TransformStep',
          id: 'step_b',
          name: 'Step B',
          transform: (ctx) => {
            stepsExecuted.push('B');
            return ctx.get('step_a');
          }
        },
        {
          type: 'ValidationStep',
          id: 'step_c',
          name: 'Step C',
          validate: (ctx) => {
            stepsExecuted.push('C');
            const data = ctx.get('step_b');
            if (!Array.isArray(data)) throw new Error('Expected array from step_b');
          }
        }
      ]
    };

    const runner = new WorkflowRunner(new ToolDispatcher(registry), { aiMode: 'mock' });

    const eventsEmitted: string[] = [];
    runner.events.onStarted(() => eventsEmitted.push('workflow:started'));
    runner.events.onStepStarted((e) => eventsEmitted.push(`step:started:${e.stepId}`));
    runner.events.onStepCompleted((e) => eventsEmitted.push(`step:completed:${e.stepId}`));
    runner.events.onCompleted(() => eventsEmitted.push('workflow:completed'));

    runner.events.onStepStarted((e) => {
      if (e.stepId === 'step_a') stepsExecuted.push('A');
    });

    const result = await runner.run(workflow, EXEC_CTX, {});

    expect(result.status).toBe('COMPLETED');
    expect(result.steps.length).toBe(3);
    expect(stepsExecuted).toEqual(['A', 'B', 'C']);
    expect(eventsEmitted).toContain('workflow:started');
    expect(eventsEmitted).toContain('workflow:completed');
    expect(eventsEmitted.indexOf('workflow:started')).toBeLessThan(eventsEmitted.indexOf('workflow:completed'));
  });

  it('accumulates context across steps correctly', async () => {
    const registry = new ToolRegistry();
    registry.register(mockSearchTool);

    const workflow: Workflow = {
      id: 'ctx_workflow',
      name: 'Context Test',
      description: '',
      steps: [
        {
          type: 'ToolStep',
          id: 'step_search',
          name: 'Search',
          toolName: 'mock_search',
          buildInput: (ctx) => ({ query: ctx.get('query') as string })
        },
        {
          type: 'TransformStep',
          id: 'step_count',
          name: 'Count',
          transform: (ctx) => {
            const results = ctx.get('step_search') as any[];
            return results.length;
          }
        }
      ]
    };

    const runner = new WorkflowRunner(new ToolDispatcher(registry), { aiMode: 'mock' });
    const result = await runner.run(workflow, EXEC_CTX, { query: 'Austin companies' });

    expect(result.status).toBe('COMPLETED');
    expect(result.output).toBe(2);
  });

  it('stops execution at failed step and emits workflow:failed', async () => {
    const registry = new ToolRegistry();
    registry.register(mockFailingTool);

    let step2Ran = false;

    const workflow: Workflow = {
      id: 'fail_workflow',
      name: 'Failure Test',
      description: '',
      steps: [
        {
          type: 'ToolStep',
          id: 'step_fail',
          name: 'Failing Step',
          toolName: 'mock_fail',
          buildInput: () => ({})
        },
        {
          type: 'TransformStep',
          id: 'step_after',
          name: 'Step After Failure',
          transform: () => {
            step2Ran = true;
            return null;
          }
        }
      ]
    };

    const runner = new WorkflowRunner(new ToolDispatcher(registry), { aiMode: 'mock' });
    const failEventsEmitted: string[] = [];
    runner.events.onFailed(() => failEventsEmitted.push('workflow:failed'));

    const result = await runner.run(workflow, EXEC_CTX, {});

    expect(result.status).toBe('FAILED');
    expect(step2Ran).toBe(false);
    expect(result.steps.length).toBe(1);
    expect(result.steps[0]!.status).toBe('FAILED');
    expect(result.error).toBeDefined();
    expect(failEventsEmitted).toContain('workflow:failed');
  });

  it('handles bounded fan-out calling tool once per input element', async () => {
    const registry = new ToolRegistry();
    registry.register(mockCrawlTool);

    const crawlCallCount = { count: 0 };
    const countingCrawlTool: Tool = {
      ...mockCrawlTool,
      name: 'counting_crawl',
      execute: async (input: any, ctx: ExecutionContext): Promise<ToolResult> => {
        crawlCallCount.count++;
        return mockCrawlTool.execute(input, ctx);
      }
    };
    registry.register(countingCrawlTool);

    const workflow: Workflow = {
      id: 'fanout_workflow',
      name: 'Fan-out Test',
      description: '',
      steps: [
        {
          type: 'ToolStep',
          id: 'step_crawl',
          name: 'Crawl Many',
          toolName: 'counting_crawl',
          buildInputs: (_ctx) => [
            { domain: 'alpha.com' },
            { domain: 'beta.com' },
            { domain: 'gamma.com' }
          ]
        }
      ]
    };

    const runner = new WorkflowRunner(new ToolDispatcher(registry), { aiMode: 'mock' });
    const result = await runner.run(workflow, EXEC_CTX, {});

    expect(result.status).toBe('COMPLETED');
    expect(crawlCallCount.count).toBe(3);
    expect(Array.isArray(result.output)).toBe(true);
    expect((result.output as any[]).length).toBe(3);
  });

  it('passes and fails correctly for ValidationStep', async () => {
    const registry = new ToolRegistry();

    const workflow: Workflow = {
      id: 'validation_workflow',
      name: 'Validation Test',
      description: '',
      steps: [
        {
          type: 'ValidationStep',
          id: 'step_validate',
          name: 'Validate Query',
          validate: (ctx) => {
            const q = ctx.get('query');
            if (!q || typeof q !== 'string' || q.length === 0) {
              throw new Error('query must be a non-empty string');
            }
          }
        }
      ]
    };

    const runner = new WorkflowRunner(new ToolDispatcher(registry), { aiMode: 'mock' });

    const pass = await runner.run(workflow, EXEC_CTX, { query: 'valid query' });
    expect(pass.status).toBe('COMPLETED');

    const fail = await runner.run(workflow, EXEC_CTX, {});
    expect(fail.status).toBe('FAILED');
  });
});
