import { describe, it, expect } from 'vitest';
import { ToolPromptBuilder } from '../tool-invocation/tool-prompt-builder';
import type { Tool } from '@huntara/agent-core';
import { z } from 'zod';

const mockTool: Tool = {
  name: 'search_leads',
  description: 'Searches leads database',
  inputSchema: z.object({ query: z.string() }),
  riskLevel: 'LOW',
  schema: {
    description: 'Searches leads description from schema',
    inputSchema: z.object({ query: z.string() }),
    outputDescription: 'List of matching leads',
    examples: [
      {
        description: 'Find software company leads',
        input: { query: 'software' }
      }
    ],
    requiresApproval: false
  },
  execute: async () => {
    throw new Error('Unused');
  }
};

describe('ToolPromptBuilder', () => {
  it('generates prompt string format for single tool description', () => {
    const desc = ToolPromptBuilder.describeOne(mockTool);
    expect(desc).toContain('Tool: search_leads');
    expect(desc).toContain('Input Schema:');
    expect(desc).toContain('Example 1: Find software company leads');
  });

  it('serializes catalog to structured JSON output properties', () => {
    const catalog = ToolPromptBuilder.buildCatalog([mockTool]);
    expect(catalog.length).toBe(1);
    expect(catalog[0]?.toolName).toBe('search_leads');
    expect(catalog[0]?.outputDescription).toBe('List of matching leads');
  });
});
