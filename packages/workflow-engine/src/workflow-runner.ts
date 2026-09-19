import { AIRuntime } from '@huntara/ai';
import type { ExecutionContext, ToolResult } from '@huntara/agent-core';
import type { Workflow, ToolStep, LLMStep, TransformStep, ValidationStep } from './workflow';
import { WorkflowContext } from './workflow-context';
import { WorkflowEvents } from './workflow-events';
import type { WorkflowResult, WorkflowStepResult } from './types';
import { ToolDispatcher } from './tool-invocation/tool-dispatcher';
import type { ToolRequest } from './tool-invocation/types';
import crypto from 'crypto';

// ─── AIConfig shape (mirrors @huntara/ai usage) ────────────────────────────

export interface AIConfig {
  readonly openRouterKey?: string | undefined;
  readonly aiMode?: 'cloud' | 'local' | 'mock' | undefined;
  readonly ollamaModel?: string | undefined;
  readonly ollamaUrl?: string | undefined;
}

// ─── WorkflowRunner ───────────────────────────────────────────────────────────

/**
 * WorkflowRunner executes an immutable Workflow definition sequentially and
 * deterministically. There is no branching, no loops, no AI decision-making.
 *
 * Execution order:
 *   1. Emit workflow:started
 *   2. For each step in order:
 *      a. Emit workflow:step:started
 *      b. Dispatch to the correct executor (Tool / LLM / Transform / Validation)
 *      c. Write output into WorkflowContext under stepId
 *      d. Emit workflow:step:completed
 *      e. On failure → emit workflow:failed, stop, return FAILED WorkflowResult
 *   3. Emit workflow:completed
 *   4. Return COMPLETED WorkflowResult
 */
export class WorkflowRunner {
  public readonly events: WorkflowEvents;
  private readonly dispatcher: ToolDispatcher;
  private readonly aiConfig: AIConfig;

  constructor(dispatcher: ToolDispatcher, aiConfig: AIConfig = { aiMode: 'mock' }) {
    this.dispatcher = dispatcher;
    this.aiConfig = aiConfig;
    this.events = new WorkflowEvents();
  }

  /**
   * Runs a workflow to completion or first failure.
   *
   * @param workflow   - Immutable workflow definition
   * @param execCtx    - Execution context scoped to this run
   * @param initial    - Seed values for WorkflowContext (e.g. { query: '...' })
   *                     Prompt definitions must be seeded as: { "prompt:<id>": promptDef }
   */
  public async run(
    workflow: Workflow,
    execCtx: ExecutionContext,
    initial: Record<string, unknown> = {}
  ): Promise<WorkflowResult> {
    const workflowStartedAt = new Date().toISOString();
    const workflowStartMs = Date.now();
    const ctx = new WorkflowContext(initial);
    const stepResults: WorkflowStepResult[] = [];

    this.events.emitStarted({
      workflowId: workflow.id,
      workflowName: workflow.name,
      traceId: execCtx.traceId,
      timestamp: workflowStartedAt,
      totalSteps: workflow.steps.length
    });

    let stepIndex = 0;
    for (const step of workflow.steps) {
      const stepStartedAt = new Date().toISOString();
      const stepStartMs = Date.now();

      this.events.emitStepStarted({
        workflowId: workflow.id,
        stepId: step.id,
        stepName: step.name,
        stepIndex,
        totalSteps: workflow.steps.length,
        traceId: execCtx.traceId,
        timestamp: stepStartedAt
      });

      try {
        const partial = await this.executeStep(step, ctx, execCtx);
        ctx.set(step.id, partial.output);

        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - stepStartMs;
        const stepResult: WorkflowStepResult = { ...partial, completedAt, durationMs };
        stepResults.push(stepResult);

        this.events.emitStepCompleted({
          workflowId: workflow.id,
          stepId: step.id,
          stepName: step.name,
          stepIndex,
          totalSteps: workflow.steps.length,
          traceId: execCtx.traceId,
          timestamp: completedAt,
          durationMs
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - stepStartMs;

        stepResults.push({
          stepId: step.id,
          stepName: step.name,
          status: 'FAILED',
          startedAt: stepStartedAt,
          completedAt,
          durationMs,
          error: errorMessage
        });

        this.events.emitFailed({
          workflowId: workflow.id,
          workflowName: workflow.name,
          traceId: execCtx.traceId,
          timestamp: completedAt,
          failedStepId: step.id,
          failedStepName: step.name,
          error: errorMessage
        });

        return {
          workflowId: workflow.id,
          workflowName: workflow.name,
          traceId: execCtx.traceId,
          status: 'FAILED',
          startedAt: workflowStartedAt,
          completedAt,
          durationMs: Date.now() - workflowStartMs,
          steps: stepResults,
          error: `Step "${step.name}" failed: ${errorMessage}`
        };
      }

      stepIndex++;
    }

    // All steps completed — extract final output from last step
    const lastStep = stepResults[stepResults.length - 1];
    const finalOutput = lastStep?.output;
    const workflowCompletedAt = new Date().toISOString();
    const workflowDurationMs = Date.now() - workflowStartMs;

    this.events.emitCompleted({
      workflowId: workflow.id,
      workflowName: workflow.name,
      traceId: execCtx.traceId,
      timestamp: workflowCompletedAt,
      durationMs: workflowDurationMs,
      stepsCompleted: stepResults.length
    });

    const base: WorkflowResult = {
      workflowId: workflow.id,
      workflowName: workflow.name,
      traceId: execCtx.traceId,
      status: 'COMPLETED',
      startedAt: workflowStartedAt,
      completedAt: workflowCompletedAt,
      durationMs: workflowDurationMs,
      steps: stepResults
    };

    if (finalOutput !== undefined) {
      return { ...base, output: finalOutput };
    }
    return base;
  }

  // ─── Step Dispatcher ───────────────────────────────────────────────────────

  private async executeStep(
    step: Workflow['steps'][number],
    ctx: WorkflowContext,
    execCtx: ExecutionContext
  ): Promise<Omit<WorkflowStepResult, 'completedAt' | 'durationMs'>> {
    const startedAt = new Date().toISOString();

    switch (step.type) {
      case 'ToolStep':
        return this.executeToolStep(step, ctx, execCtx, startedAt);
      case 'LLMStep':
        return this.executeLLMStep(step, ctx, startedAt);
      case 'TransformStep':
        return this.executeTransformStep(step, ctx, startedAt);
      case 'ValidationStep':
        return this.executeValidationStep(step, ctx, startedAt);
      default: {
        // TypeScript exhaustiveness guard
        const _never: never = step;
        throw new Error(`Unknown step type: ${JSON.stringify(_never)}`);
      }
    }
  }

  // ─── ToolStep ──────────────────────────────────────────────────────────────

  private async executeToolStep(
    step: ToolStep,
    ctx: WorkflowContext,
    execCtx: ExecutionContext,
    startedAt: string
  ): Promise<Omit<WorkflowStepResult, 'completedAt' | 'durationMs'>> {
    // Bounded fan-out: invoke tool once per input in the returned array
    if (step.buildInputs) {
      const inputs = step.buildInputs(ctx);
      const toolResults: ToolResult[] = [];

      for (const input of inputs) {
        const req: ToolRequest = {
          requestId: crypto.randomUUID(),
          toolName: step.toolName,
          arguments: input as Record<string, unknown>,
          traceId: execCtx.traceId,
          workspaceId: execCtx.workspaceId,
          invokedBy: step.id,
          timestamp: new Date().toISOString(),
          requiresApproval: this.dispatcher.toolRequiresApproval(step.toolName)
        };

        const res = await this.dispatcher.dispatch(req, execCtx);
        if (!res.success) {
          throw new Error(res.error?.message ?? `Tool "${step.toolName}" failed`);
        }
        if (res.toolResult) {
          toolResults.push(res.toolResult);
        }
      }

      return {
        stepId: step.id,
        stepName: step.name,
        status: 'COMPLETED',
        startedAt,
        output: toolResults.map((r) => (r.success ? r.data : null)),
        toolResults
      };
    }

    // Single invocation
    const input = step.buildInput ? step.buildInput(ctx) : {};
    const req: ToolRequest = {
      requestId: crypto.randomUUID(),
      toolName: step.toolName,
      arguments: input as Record<string, unknown>,
      traceId: execCtx.traceId,
      workspaceId: execCtx.workspaceId,
      invokedBy: step.id,
      timestamp: new Date().toISOString(),
      requiresApproval: this.dispatcher.toolRequiresApproval(step.toolName)
    };

    const res = await this.dispatcher.dispatch(req, execCtx);
    if (!res.success) {
      throw new Error(res.error?.message ?? `Tool "${step.toolName}" failed`);
    }

    const toolResults: ToolResult[] = [];
    if (res.toolResult) {
      toolResults.push(res.toolResult);
    }

    return {
      stepId: step.id,
      stepName: step.name,
      status: 'COMPLETED',
      startedAt,
      output: res.data,
      toolResults
    };
  }

  // ─── LLMStep ──────────────────────────────────────────────────────────────

  private async executeLLMStep(
    step: LLMStep,
    ctx: WorkflowContext,
    startedAt: string
  ): Promise<Omit<WorkflowStepResult, 'completedAt' | 'durationMs'>> {
    const input = step.buildInput(ctx);

    // Prompt definitions are seeded into context under "prompt:<promptId>"
    const promptDef = ctx.get(`prompt:${step.promptId}`) as any;
    if (!promptDef) {
      throw new Error(
        `LLMStep "${step.name}": prompt definition for "${step.promptId}" not found in WorkflowContext. ` +
          `Seed it via initial["prompt:${step.promptId}"] = promptDefinition before calling run().`
      );
    }

    const aiRes = await AIRuntime.execute(promptDef, input, this.aiConfig);
    if (!aiRes.success) {
      throw new Error(aiRes.error ?? `LLM step "${step.name}" failed`);
    }

    return {
      stepId: step.id,
      stepName: step.name,
      status: 'COMPLETED',
      startedAt,
      output: aiRes.data
    };
  }

  // ─── TransformStep ────────────────────────────────────────────────────────

  private async executeTransformStep(
    step: TransformStep,
    ctx: WorkflowContext,
    startedAt: string
  ): Promise<Omit<WorkflowStepResult, 'completedAt' | 'durationMs'>> {
    const output = step.transform(ctx);
    return {
      stepId: step.id,
      stepName: step.name,
      status: 'COMPLETED',
      startedAt,
      output
    };
  }

  // ─── ValidationStep ───────────────────────────────────────────────────────

  private async executeValidationStep(
    step: ValidationStep,
    ctx: WorkflowContext,
    startedAt: string
  ): Promise<Omit<WorkflowStepResult, 'completedAt' | 'durationMs'>> {
    // validate() throws to signal failure; returning normally means success
    step.validate(ctx);
    return {
      stepId: step.id,
      stepName: step.name,
      status: 'COMPLETED',
      startedAt,
      output: undefined
    };
  }
}
