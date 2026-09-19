import type { Workflow } from '@huntara/workflow-engine';
import { ResearchSummaryPrompt } from '../research-agent-prompt';

/**
 * ResearchWorkflow — immutable, ordered step definition for the Research Agent.
 *
 * Step 1: Search Local Businesses  (ToolStep — single invocation)
 * Step 2: Crawl Company Websites   (ToolStep — bounded fan-out per company)
 * Step 3: Summarize Results        (LLMStep  — consolidates findings)
 *
 * No branching. No loops. No conditions.
 * The WorkflowRunner executes these steps in this exact order.
 */
export const ResearchWorkflow: Workflow = {
  id: 'research_workflow',
  name: 'Research Workflow',
  description:
    'Searches local businesses on Google Maps and crawls their websites for contact details.',
  steps: [
    // ── Step 1: Map Search ─────────────────────────────────────────────────
    {
      type: 'ToolStep',
      id: 'step_search',
      name: 'Search Local Businesses',
      toolName: 'search_local_businesses',
      buildInput: (ctx) => ({
        query: ctx.get('query') as string,
        limit: 3
      })
    },

    // ── Step 2: Website Crawler (bounded fan-out per discovered company) ───
    {
      type: 'ToolStep',
      id: 'step_crawl',
      name: 'Crawl Company Websites',
      toolName: 'crawl_company_website',
      buildInputs: (ctx) => {
        const searchOutput = ctx.get('step_search');
        const companies = Array.isArray(searchOutput)
          ? searchOutput
          : ((searchOutput as any)?.companies ?? (searchOutput as any)?.results ?? []);

        return (companies as any[])
          .slice(0, 3)
          .filter((c: any) => c.domain || c.website)
          .map((c: any) => ({
            companyId: c.id ?? 'tmp-id',
            domain: c.domain ?? c.website
          }));
      }
    },

    // ── Step 3: LLM Summary ────────────────────────────────────────────────
    {
      type: 'LLMStep',
      id: 'step_summarize',
      name: 'Summarize Research Results',
      promptId: ResearchSummaryPrompt.id,
      buildInput: (ctx) => ({
        query: ctx.get('query') as string,
        scraperResults: ctx.get('step_search') ?? [],
        crawlerResults: ctx.get('step_crawl') ?? []
      })
    }
  ]
} as const;
