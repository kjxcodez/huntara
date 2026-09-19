import type { ToolRegistry, BaseAgent, ExecutionContext } from '@huntara/agent-core';
import type { AIConfig, WorkflowResult } from '@huntara/workflow-engine';
import { WorkflowRunner, ToolDispatcher } from '@huntara/workflow-engine';
import { AgentSession } from './agent-session';
import { ContextBuilder } from './context-builder';
import { ResponseAssembler } from './response-assembler';
import type { AgentResponse } from './types';
import { ResearchWorkflow } from './workflows/research-workflow';
import { ResearchSummaryPrompt } from './research-agent-prompt';

// ─── Workflow Registry ────────────────────────────────────────────────────────
// Maps workflowId → Workflow definition. Extend this map as new workflows are added.

import type { Workflow } from '@huntara/workflow-engine';

const WORKFLOW_REGISTRY: Record<string, Workflow> = {
  research_workflow: ResearchWorkflow
};

// ─── AgentRuntime ─────────────────────────────────────────────────────────────

export class AgentRuntime {
  private readonly registry: ToolRegistry;
  private readonly aiConfig: AIConfig;
  private readonly listeners: Map<string, Array<(session: AgentSession) => void>> = new Map();

  constructor(registry: ToolRegistry, aiConfig: AIConfig = { aiMode: 'mock' }) {
    this.registry = registry;
    this.aiConfig = aiConfig;
  }

  /**
   * Executes an agent request by delegating to the WorkflowRunner.
   * The AgentRuntime no longer hardcodes execution order — the Workflow
   * definition is the single source of truth for step ordering.
   */
  public async execute(
    agent: BaseAgent,
    query: string,
    params: {
      readonly workspaceId: string;
      readonly executionId: string;
      readonly traceId: string;
      readonly actorId: string;
      readonly workspaceSettings?: Record<string, unknown> | undefined;
      readonly conversationHistory?:
        Array<{ readonly role: string; readonly content: string }> | undefined;
    }
  ): Promise<AgentResponse> {
    const session = new AgentSession(params.traceId);
    session.on('state-change', () => {
      this.emit('session-change', session);
    });
    session.transition('CREATED', `Initialized session for agent: ${agent.name}`);

    const startedAt = session.startedAt;

    try {
      // ── Build execution context ───────────────────────────────────────────
      session.transition('PREPARING_CONTEXT', 'Building execution context');

      const { executionContext } = ContextBuilder.build({
        workspaceId: params.workspaceId,
        executionId: params.executionId,
        traceId: params.traceId,
        actorId: params.actorId,
        query,
        workspaceSettings: params.workspaceSettings,
        conversationHistory: params.conversationHistory
      });

      // ── Resolve workflow ──────────────────────────────────────────────────
      const workflowId = agent.workflowId;
      const workflow = workflowId ? WORKFLOW_REGISTRY[workflowId] : undefined;
      if (!workflow) {
        throw new Error(
          `Agent "${agent.name}" has no registered workflow. ` +
            `Set workflowId on the agent and register it in AgentRuntime's WORKFLOW_REGISTRY.`
        );
      }

      // ── Create runner and wire lifecycle events into session ──────────────
      const dispatcher = new ToolDispatcher(this.registry);
      const runner = new WorkflowRunner(dispatcher, this.aiConfig);

      runner.events.onStepStarted((ev) => {
        session.transition('EXECUTING_TOOL', `Running step: ${ev.stepName}`);
      });

      runner.events.onStepCompleted((ev) => {
        session.transition('RECEIVING_TOOL_RESULT', `Step completed: ${ev.stepName}`);
      });

      // ── Seed initial context ──────────────────────────────────────────────
      // Prompt definitions are seeded so LLMSteps can resolve them by ID.
      const initial: Record<string, unknown> = {
        query,
        [`prompt:${ResearchSummaryPrompt.id}`]: ResearchSummaryPrompt
      };

      // ── Delegate execution to WorkflowRunner ──────────────────────────────
      session.transition('CALLING_LLM', 'Delegating to WorkflowRunner');
      const workflowResult: WorkflowResult = await runner.run(workflow, executionContext, initial);

      if (workflowResult.status === 'FAILED') {
        throw new Error(workflowResult.error ?? 'Workflow execution failed');
      }

      // ── Assemble structured response ──────────────────────────────────────
      session.transition('GENERATING_RESPONSE', 'Assembling final response');

      const toolsExecuted = workflowResult.steps.flatMap((s) =>
        (s.toolResults ?? []).map((r) => ({ toolName: s.stepName, result: r }))
      );

      const response = ResponseAssembler.assemble({
        success: true,
        data: workflowResult.output,
        message:
          typeof workflowResult.output === 'string'
            ? workflowResult.output
            : `Workflow "${workflow.name}" completed in ${workflowResult.durationMs}ms`,
        traceId: params.traceId,
        toolsExecuted,
        startedAt
      });

      session.transition('COMPLETED', 'Research execution completed successfully');
      this.emit('session-change', session);
      return response;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      session.transition('FAILED', `Execution failed: ${msg}`);

      const failedResponse = ResponseAssembler.assemble({
        success: false,
        message: `Execution error: ${msg}`,
        traceId: params.traceId,
        toolsExecuted: [],
        startedAt
      });

      this.emit('session-change', session);
      return failedResponse;
    }
  }

  /**
   * Subscribes a listener to session progress events emitted during execution.
   */
  public subscribe(listener: (session: AgentSession) => void): () => void {
    if (!this.listeners.has('session-change')) {
      this.listeners.set('session-change', []);
    }
    this.listeners.get('session-change')!.push(listener);
    return () => {
      const idx = this.listeners.get('session-change')!.indexOf(listener);
      if (idx !== -1) {
        this.listeners.get('session-change')!.splice(idx, 1);
      }
    };
  }

  private emit(event: string, session: AgentSession): void {
    const list = this.listeners.get(event) ?? [];
    for (const listener of list) {
      listener(session);
    }
  }
}
