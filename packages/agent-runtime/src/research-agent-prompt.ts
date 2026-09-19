import { z } from 'zod';
import type { PromptDefinition } from '@huntara/ai';

export const ResearchSummaryInputSchema = z.object({
  query: z.string(),
  scraperResults: z.any(),
  crawlerResults: z.any()
});

export type ResearchSummaryInput = z.infer<typeof ResearchSummaryInputSchema>;

export const ResearchSummaryPrompt: PromptDefinition<ResearchSummaryInput, string> = {
  id: 'research_summary',
  version: '1.0.0',
  render: (input) => `You are the LeadForge Research Agent.
We searched Google Maps for: "${input.query}". Results:
${JSON.stringify(input.scraperResults, null, 2)}

We crawled domains of discovered companies. Results:
${JSON.stringify(input.crawlerResults, null, 2)}

Summarize these findings in a concise, professional report. Expose company names, websites, and found emails.`,
  validateOutput: (res) => res.trim()
};
