import { z } from 'zod';
import type { Tool, ToolResult, ExecutionContext, SchedulerGateway } from '@huntara/agent-core';

export const CrawlWebsiteInputSchema = z.object({
  companyId: z.string().min(1, 'Company ID is required'),
  domain: z.string().min(1, 'Domain is required'),
  maxDepth: z.number().int().positive().optional()
});

export type CrawlWebsiteInput = z.infer<typeof CrawlWebsiteInputSchema>;

export class CrawlWebsiteTool implements Tool<CrawlWebsiteInput, unknown> {
  public readonly name = 'crawl_company_website';
  public readonly description =
    'Crawls a targeted business domain website to discover contact details (emails, phone numbers, and social URLs).';
  public readonly inputSchema = CrawlWebsiteInputSchema;
  public readonly riskLevel = 'LOW' as const;
  private readonly gateway: SchedulerGateway;

  constructor(gateway: SchedulerGateway) {
    this.gateway = gateway;
  }

  public async execute(
    input: CrawlWebsiteInput,
    context: ExecutionContext
  ): Promise<ToolResult<unknown>> {
    const parseResult = CrawlWebsiteInputSchema.safeParse(input);
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

    return this.gateway.submitAndAwait('crawler:website', parseResult.data, context);
  }
}
