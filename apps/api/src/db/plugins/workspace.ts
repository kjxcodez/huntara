import { generateEntityId } from '@huntara/schema';
import type { Schema } from 'mongoose';

export interface WorkspaceScopedDocument {
  workspaceId: string;
}

export function workspacePlugin(schema: Schema) {
  schema.add({
    _id: {
      type: String,
      required: true,
      default: () => generateEntityId()
    },
    workspaceId: {
      type: String,
      required: true,
      index: true
    }
  });
}

