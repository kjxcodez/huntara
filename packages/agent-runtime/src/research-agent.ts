import type { BaseAgent } from '@huntara/agent-core';

export const ResearchAgent: BaseAgent = {
  id: 'research_agent',
  name: 'LeadForge Research Agent',
  description:
    'Searches local businesses on Google Maps and crawls their websites for contact details.',
  systemPrompt: `You are the LeadForge Research Agent. Your task is to discover businesses and find contact details.
You operate sequentially:
1. Search local businesses using the search query and location parameters.
2. Crawl the domains of the discovered companies to find contact information (emails and social handles).
3. Summarize the research outcomes into a structured report.`,
  tools: ['search_local_businesses', 'crawl_company_website'],
  workflowId: 'research_workflow'
};
