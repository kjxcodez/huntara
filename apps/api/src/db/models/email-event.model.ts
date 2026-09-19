import mongoose, { Schema } from 'mongoose';
import {
  workspacePlugin,
  timestampPlugin,
  type WorkspaceScopedDocument,
  type TimestampDocument
} from '../plugins/index.js';
import { EmailEventType } from '@huntara/schema';

export interface EmailEventDocument
  extends mongoose.Document,
    WorkspaceScopedDocument,
    TimestampDocument {
  deliveryId: string;
  contactId?: string | null;
  campaignId?: string | null;
  type: EmailEventType;
  occurredAt: Date;
  receivedAt: Date;
  metadata?: Record<string, any> | null;
  dedupeKey: string;
}

const emailEventSchema = new Schema<EmailEventDocument>(
  {
    deliveryId: { type: String, required: true, index: true },
    contactId: { type: String, default: null, index: true },
    campaignId: { type: String, default: null, index: true },
    type: {
      type: String,
      required: true,
      enum: Object.values(EmailEventType),
      index: true
    },
    occurredAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    metadata: { type: Schema.Types.Mixed, default: null },
    dedupeKey: { type: String, required: true }
  },
  {
    strict: true
  }
);

// Indexes:
// 1. Idempotency on dedupeKey within workspace
emailEventSchema.index({ workspaceId: 1, dedupeKey: 1 }, { unique: true });
// 2. Timeline queries by delivery / message
emailEventSchema.index({ workspaceId: 1, deliveryId: 1, occurredAt: -1 });
// 3. Timeline queries by contact
emailEventSchema.index({ workspaceId: 1, contactId: 1, occurredAt: -1 });

emailEventSchema.plugin(workspacePlugin);
emailEventSchema.plugin(timestampPlugin);

export const EmailEventModel = mongoose.models.EmailEvent
  ? (mongoose.models.EmailEvent as mongoose.Model<EmailEventDocument>)
  : mongoose.model<EmailEventDocument>('EmailEvent', emailEventSchema);
