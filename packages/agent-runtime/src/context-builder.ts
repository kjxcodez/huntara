import type {
  ExecutionContext,
  ToolCatalogEntry,
  ProviderCapabilities
} from '@huntara/agent-core';

export interface CompiledAgentContext {
  readonly executionContext: ExecutionContext;
  readonly promptParams: {
    readonly query: string;
    readonly workspaceSettings: Record<string, unknown>;
    readonly conversationHistory: Array<{ readonly role: string; readonly content: string }>;
    readonly availableTools: ToolCatalogEntry[];
    readonly capabilities: ProviderCapabilities;
  };
}

export class ContextBuilder {
  /**
   * Compiles execution parameters and catalog configurations into a unified context mapping.
   */
  public static build(params: {
    readonly workspaceId: string;
    readonly executionId: string;
    readonly traceId: string;
    readonly actorId: string;
    readonly query: string;
    readonly workspaceSettings?: Record<string, unknown> | undefined;
    readonly conversationHistory?:
      Array<{ readonly role: string; readonly content: string }> | undefined;
    readonly availableTools?: ToolCatalogEntry[] | undefined;
    readonly capabilities?: ProviderCapabilities | undefined;
  }): CompiledAgentContext {
    const executionContext: ExecutionContext = {
      workspaceId: params.workspaceId,
      executionId: params.executionId,
      traceId: params.traceId,
      actorId: params.actorId,
      actorType: 'user',
      requestedBy: 'agent-runtime',
      permissions: ['network', 'filesystem'],
      executionMode: 'offline'
    };

    const defaultCapabilities: ProviderCapabilities = {
      supportsVision: false,
      supportsImages: false,
      supportsAudio: false,
      supportsEmbeddings: false,
      supportsStreaming: true,
      supportsTools: true,
      supportsStructuredOutputs: true,
      supportsThinking: false,
      supportsReasoning: false,
      supportsContextCaching: false,
      supportsLargeContext: false,
      supportsJSON: true,
      supportsFunctionCalling: true,
      supportsMCP: false
    };

    return {
      executionContext,
      promptParams: {
        query: params.query,
        workspaceSettings: params.workspaceSettings || {},
        conversationHistory: params.conversationHistory || [],
        availableTools: params.availableTools || [],
        capabilities: params.capabilities || defaultCapabilities
      }
    };
  }
}
