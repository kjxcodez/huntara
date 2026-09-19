import { z } from 'zod';
import type { Tool, ToolResult, ExecutionContext, SchedulerGateway } from '@huntara/agent-core';

export const SearchLocalBusinessesInputSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  limit: z.number().int().positive().optional()
});

export type SearchLocalBusinessesInput = z.infer<typeof SearchLocalBusinessesInputSchema>;

export class SearchLocalBusinessesTool implements Tool<SearchLocalBusinessesInput, unknown> {
  public readonly name = 'search_local_businesses';
  public readonly description =
    'Searches local businesses on Google Maps by query and geographical context to discover company profiles.';
  public readonly inputSchema = SearchLocalBusinessesInputSchema;
  public readonly riskLevel = 'LOW' as const;
  private readonly gateway: SchedulerGateway;

  constructor(gateway: SchedulerGateway) {
    this.gateway = gateway;
  }

  public async execute(
    input: SearchLocalBusinessesInput,
    context: ExecutionContext
  ): Promise<ToolResult<unknown>> {
    const parseResult = SearchLocalBusinessesInputSchema.safeParse(input);
    if (!parseResult.success) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid input parameters: ${parseResult.error.message}`,
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

    return this.gateway.submitAndAwait('scraper:maps', parseResult.data, context);
  }
}
