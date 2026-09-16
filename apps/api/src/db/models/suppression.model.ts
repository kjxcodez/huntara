import mongoose, { Schema } from 'mongoose';
import { workspacePlugin, type WorkspaceScopedDocument } from '../plugins/index.js';
import { SuppressionReason, SuppressionTargetType } from '@leadforge/schema';

export interface SuppressionDocument extends mongoose.Document, WorkspaceScopedDocument {
  targetType: SuppressionTargetType;
  targetId: string;
  email?: string | null;
  companyId?: string | null;
  domain?: string | null;
  reason: SuppressionReason;
  source: string;
  evidence?: Record<string, any> | null;
  suppressedAt: Date;
  suppressedBy?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const suppressionSchema = new Schema<SuppressionDocument>(
  {
    workspaceId: { type: String, required: true, index: true },
    targetType: {
      type: String,
      enum: Object.values(SuppressionTargetType),
      default: SuppressionTargetType.RECIPIENT,
      required: true
    },
    targetId: { type: String, required: true, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    companyId: { type: String, default: null, trim: true },
    domain: { type: String, default: null, trim: true, lowercase: true },
    reason: {
      type: String,
      enum: Object.values(SuppressionReason),
      required: true
    },
    source: { type: String, default: 'system' },
    evidence: { type: Schema.Types.Mixed, default: null },
    suppressedAt: { type: Date, default: Date.now, required: true },
    suppressedBy: { type: String, default: null },
    notes: { type: String, default: null }
  },
  {
    timestamps: true,
    collection: 'suppressions'
  }
);

suppressionSchema.plugin(workspacePlugin);
suppressionSchema.index({ workspaceId: 1, targetType: 1, targetId: 1 }, { unique: true });
suppressionSchema.index({ workspaceId: 1, targetType: 1, companyId: 1 }, { sparse: true });
suppressionSchema.index({ workspaceId: 1, targetType: 1, domain: 1 }, { sparse: true });
suppressionSchema.index({ workspaceId: 1, email: 1 }, { sparse: true });
suppressionSchema.index({ workspaceId: 1, reason: 1 });

export const SuppressionModel =
  (mongoose.models.Suppression as mongoose.Model<SuppressionDocument>) ||
  mongoose.model<SuppressionDocument>('Suppression', suppressionSchema);
