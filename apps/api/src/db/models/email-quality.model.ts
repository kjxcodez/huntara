import mongoose, { Schema } from 'mongoose';
import { workspacePlugin, type WorkspaceScopedDocument } from '../plugins/index.js';
import { EmailQualityStatus } from '@huntara/schema';

export interface EmailQualityDocument extends mongoose.Document, WorkspaceScopedDocument {
  email: string;
  status: EmailQualityStatus;
  sendable: boolean;
  riskLevel: 'low' | 'moderate' | 'high' | 'prohibited';
  reasons: string[];
  evidence: any[];
  recommendedAction: string;
  evaluatedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const emailQualitySchema = new Schema<EmailQualityDocument>(
  {
    workspaceId: { type: String, required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    status: {
      type: String,
      enum: Object.values(EmailQualityStatus),
      required: true
    },
    sendable: { type: Boolean, required: true },
    riskLevel: {
      type: String,
      enum: ['low', 'moderate', 'high', 'prohibited'],
      required: true
    },
    reasons: { type: [String], default: [] },
    evidence: { type: Schema.Types.Mixed, default: [] },
    recommendedAction: { type: String, required: true },
    evaluatedAt: { type: Date, default: Date.now, required: true },
    expiresAt: { type: Date, required: true }
  },
  {
    timestamps: true,
    collection: 'email_quality_cache'
  }
);

emailQualitySchema.plugin(workspacePlugin);
emailQualitySchema.index({ workspaceId: 1, email: 1 }, { unique: true });
emailQualitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB TTL index

export const EmailQualityModel =
  (mongoose.models.EmailQuality as mongoose.Model<EmailQualityDocument>) ||
  mongoose.model<EmailQualityDocument>('EmailQuality', emailQualitySchema);
