import { ipcMain } from 'electron';
import { AgentRuntime, ResearchAgent } from '@huntara/agent-runtime';
import { WorkflowRunner, ToolDispatcher } from '@huntara/workflow-engine';
import { ResearchWorkflow } from '@huntara/agent-runtime';
import { ResearchSummaryPrompt } from '@huntara/agent-runtime';
import { ContextBuilder } from '@huntara/agent-runtime';
import { createWorkspaceToolRegistry } from '../ai/tools/registry';
import { WorkspaceManager } from '../lib/workspace-manager';

/**
 * Registers main process Electron IPC handlers for executing agents.
 *
 * Channels registered:
 *   agent:execute          — Runs the full agent workflow, returns AgentResponse
 *   agent:workflow:execute — Runs the workflow directly with live progress events
 *                           pushed to the renderer via webContents.send('agent:workflow:progress')
 */
export function registerAgentIPCHandlers(): void {
  // ── Full agent execute (existing channel) ──────────────────────────────────
  ipcMain.handle(
    'agent:execute',
    async (
      _event,
      params: {
        readonly workspaceId: string;
        readonly query: string;
        readonly traceId: string;
        readonly actorId: string;
        readonly aiConfig?: {
          readonly openRouterKey?: string;
          readonly aiMode?: 'cloud' | 'local' | 'mock';
          readonly ollamaModel?: string;
          readonly ollamaUrl?: string;
        };
      }
    ) => {
      const runtimeInstance = WorkspaceManager.getActiveRuntime();
      if (!runtimeInstance || runtimeInstance.workspaceId !== params.workspaceId) {
        throw new Error(`Workspace runtime is not active for workspace: ${params.workspaceId}`);
      }

      const db = runtimeInstance.sqliteDb;
      const eventBus = runtimeInstance.eventBus;
      const registry = createWorkspaceToolRegistry(db, eventBus);

      const runtime = new AgentRuntime(registry, params.aiConfig ?? { aiMode: 'mock' });

      return await runtime.execute(ResearchAgent, params.query, {
        workspaceId: params.workspaceId,
        executionId: params.traceId,
        traceId: params.traceId,
        actorId: params.actorId
      });
    }
  );

  // ── Workflow execute with live progress events ─────────────────────────────
  // Renderer subscribes to:  ipcRenderer.on('agent:workflow:progress', (ev, payload) => ...)
  // Renderer triggers with:  ipcRenderer.invoke('agent:workflow:execute', params)
  ipcMain.handle(
    'agent:workflow:execute',
    async (
      event,
      params: {
        readonly workspaceId: string;
        readonly query: string;
        readonly traceId: string;
        readonly actorId: string;
        readonly aiConfig?: {
          readonly openRouterKey?: string;
          readonly aiMode?: 'cloud' | 'local' | 'mock';
          readonly ollamaModel?: string;
          readonly ollamaUrl?: string;
        };
      }
    ) => {
      const runtimeInstance = WorkspaceManager.getActiveRuntime();
      if (!runtimeInstance || runtimeInstance.workspaceId !== params.workspaceId) {
        throw new Error(`Workspace runtime is not active for workspace: ${params.workspaceId}`);
      }

      const db = runtimeInstance.sqliteDb;
      const eventBus = runtimeInstance.eventBus;
      const registry = createWorkspaceToolRegistry(db, eventBus);

      const dispatcher = new ToolDispatcher(registry);
      const runner = new WorkflowRunner(dispatcher, params.aiConfig ?? { aiMode: 'mock' });

      // ── Wire workflow events → renderer progress channel ─────────────────
      const sendProgress = (stage: string, payload: Record<string, unknown>) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('agent:workflow:progress', {
            traceId: params.traceId,
            stage,
            ...payload
          });
        }
      };

      runner.events.onStarted((ev) => {
        sendProgress('PREPARING', {
          workflowId: ev.workflowId,
          workflowName: ev.workflowName,
          totalSteps: ev.totalSteps
        });
      });

      runner.events.onStepStarted((ev) => {
        sendProgress('RUNNING_STEP', {
          stepId: ev.stepId,
          stepName: ev.stepName,
          stepIndex: ev.stepIndex,
          totalSteps: ev.totalSteps
        });
      });

      runner.events.onStepCompleted((ev) => {
        sendProgress('STEP_COMPLETED', {
          stepId: ev.stepId,
          stepName: ev.stepName,
          stepIndex: ev.stepIndex,
          durationMs: ev.durationMs
        });
      });

      runner.events.onCompleted((ev) => {
        sendProgress('COMPLETED', {
          durationMs: ev.durationMs,
          stepsCompleted: ev.stepsCompleted
        });
      });

      runner.events.onFailed((ev) => {
        sendProgress('FAILED', {
          failedStepId: ev.failedStepId,
          failedStepName: ev.failedStepName,
          error: ev.error
        });
      });

      // ── Build execution context ──────────────────────────────────────────
      const { executionContext } = ContextBuilder.build({
        workspaceId: params.workspaceId,
        executionId: params.traceId,
        traceId: params.traceId,
        actorId: params.actorId,
        query: params.query
      });

      const initial: Record<string, unknown> = {
        query: params.query,
        [`prompt:${ResearchSummaryPrompt.id}`]: ResearchSummaryPrompt
      };

      return await runner.run(ResearchWorkflow, executionContext, initial);
    }
  );
}
