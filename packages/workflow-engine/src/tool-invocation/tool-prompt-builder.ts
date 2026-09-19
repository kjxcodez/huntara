import type { Tool } from '@huntara/agent-core';

export class ToolPromptBuilder {
  /**
   * Generates a text block describing one tool's schema and examples.
   */
  public static describeOne(tool: Tool): string {
    const desc = tool.schema?.description ?? tool.description;
    const inputSchemaStr = this.serializeZodSchema(tool.schema?.inputSchema ?? tool.inputSchema);
    const outputDesc = tool.schema?.outputDescription ?? 'Structured tool output';

    let examplesText = 'None';
    if (tool.schema?.examples && tool.schema.examples.length > 0) {
      examplesText = tool.schema.examples
        .map(
          (ex, idx) => `Example ${idx + 1}: ${ex.description}\nInput: ${JSON.stringify(ex.input)}`
        )
        .join('\n\n');
    }

    const requiresApproval = tool.schema?.requiresApproval ?? tool.riskLevel === 'HIGH';

    return [
      `Tool: ${tool.name}`,
      `Description: ${desc}`,
      `Input Schema:\n${inputSchemaStr}`,
      `Output Description: ${outputDesc}`,
      `Requires Human Approval: ${requiresApproval ? 'Yes' : 'No'}`,
      `Examples:\n${examplesText}`
    ].join('\n\n');
  }

  /**
   * Generates a concatenated description for a list of tools.
   */
  public static describeMany(tools: Tool[]): string {
    return tools
      .map((t) => this.describeOne(t))
      .join('\n\n======================================\n\n');
  }

  /**
   * Generates a JSON-structured tool catalog for structured prompts.
   */
  public static buildCatalog(tools: Tool[]): Array<Record<string, any>> {
    return tools.map((tool) => {
      const requiresApproval = tool.schema?.requiresApproval ?? tool.riskLevel === 'HIGH';
      return {
        toolName: tool.name,
        description: tool.schema?.description ?? tool.description,
        inputSchema: this.serializeZodSchema(tool.schema?.inputSchema ?? tool.inputSchema),
        outputDescription: tool.schema?.outputDescription ?? 'Structured tool output',
        requiresApproval,
        examples: tool.schema?.examples ?? []
      };
    });
  }

  private static serializeZodSchema(schema: any): string {
    if (!schema) return 'unknown';
    if (schema._def?.typeName === 'ZodObject') {
      const shape = schema.shape;
      const properties: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        const typeName = (value as any)._def?.typeName?.replace('Zod', '')?.toLowerCase() ?? 'any';
        const isOptional =
          (value as any)._def?.typeName === 'ZodOptional' || (value as any).isOptional?.() === true;
        properties.push(`  - ${key}: ${typeName}${isOptional ? ' (optional)' : ''}`);
      }
      return `Object containing:\n${properties.join('\n')}`;
    }
    return schema._def?.typeName?.replace('Zod', '')?.toLowerCase() ?? 'any';
  }
}
