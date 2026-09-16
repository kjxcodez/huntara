import mongoose, { Schema } from 'mongoose';
import {
  softDeletePlugin,
  auditPlugin,
  timestampPlugin,
  workspacePlugin,
  type SoftDeleteDocument,
  type AuditDocument,
  type TimestampDocument,
  type WorkspaceScopedDocument
} from '../plugins/index.js';

export interface CampaignStep {
  id: string;
  type: string;
  delayDays: number;
  templateId: string;
}

export interface CampaignDocument
  extends
    mongoose.Document,
    SoftDeleteDocument,
    AuditDocument,
    TimestampDocument,
    WorkspaceScopedDocument {
  name: string;
  description?: string | null;
  sequenceId?: string | null;
  sendingAccountId?: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'STOPPED' | 'COMPLETED' | 'FAILED';
  steps: CampaignStep[];
  template?: string | null;
  schedule?: Record<string, any> | string | null;
  timezone: string;
  dailyLimit: number;
  trackingEnabled?: boolean | null;
  settings?: Record<string, any> | null;
  idempotencyKey?: string | null;
}

const campaignSchema = new Schema<CampaignDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      default: null,
      trim: true
    },
    sequenceId: {
      type: String,
      default: null,
      index: true
    },
    sendingAccountId: {
      type: String,
      default: null,
      index: true
    },
    status: {
      type: String,
      enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'STOPPED', 'COMPLETED', 'FAILED'],
      default: 'DRAFT'
    },
    steps: [
      {
        id: { type: String, required: true },
        type: { type: String, required: true },
        delayDays: { type: Number, default: 0 },
        templateId: { type: String, required: true }
      }
    ],
    template: {
      type: String,
      default: null
    },
    schedule: {
      type: Schema.Types.Mixed,
      default: null
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    dailyLimit: {
      type: Number,
      default: 0
    },
    trackingEnabled: {
      type: Boolean,
      default: false
    },
    settings: {
      type: Schema.Types.Mixed,
      default: null
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true
    }
  },
  {
    strict: true,
    optimisticConcurrency: true
  }
);

campaignSchema.index({ workspaceId: 1, status: 1 });
campaignSchema.index({ workspaceId: 1, sequenceId: 1 });

campaignSchema.plugin(workspacePlugin);
campaignSchema.plugin(softDeletePlugin);
campaignSchema.plugin(auditPlugin);
campaignSchema.plugin(timestampPlugin);

export const CampaignModel = mongoose.models.Campaign
  ? (mongoose.models.Campaign as mongoose.Model<CampaignDocument>)
  : mongoose.model<CampaignDocument>('Campaign', campaignSchema);
