import mongoose, { Schema } from 'mongoose';
import {
  workspacePlugin,
  softDeletePlugin,
  timestampPlugin,
  type WorkspaceScopedDocument,
  type SoftDeleteDocument,
  type TimestampDocument
} from '../plugins/index.js';
import type { LeadConfidence } from '@huntara/schema';

export interface CompanyIntelligenceDocument
  extends mongoose.Document,
    WorkspaceScopedDocument,
    SoftDeleteDocument,
    TimestampDocument {
  companyId: string;
  summary?: string | null;
  openingLine?: string | null;
  techStack: string[];
  businessModel?: string | null;
  estimatedRevenue?: string | null;
  growthSignals: string[];
  hiringSignals: string[];
  decisionMakerLikelihood?: number | null;
  leadConfidence?: LeadConfidence | null;
  missingInformation: string[];
}

const companyIntelligenceSchema = new Schema<CompanyIntelligenceDocument>(
  {
    companyId: {
      type: String,
      required: true,
      index: true
    },
    summary: { type: String, default: null },
    openingLine: { type: String, default: null },
    techStack: { type: [String], default: [] },
    businessModel: { type: String, default: null },
    estimatedRevenue: { type: String, default: null },
    growthSignals: { type: [String], default: [] },
    hiringSignals: { type: [String], default: [] },
    decisionMakerLikelihood: { type: Number, default: null, min: 0, max: 1 },
    leadConfidence: {
      type: String,
      enum: ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH', null],
      default: null
    },
    missingInformation: { type: [String], default: [] }
  },
  {
    strict: true
  }
);

companyIntelligenceSchema.index({ workspaceId: 1, companyId: 1 }, { unique: true });

companyIntelligenceSchema.plugin(workspacePlugin);
companyIntelligenceSchema.plugin(softDeletePlugin);
companyIntelligenceSchema.plugin(timestampPlugin);

export const CompanyIntelligenceModel = mongoose.models.CompanyIntelligence
  ? (mongoose.models.CompanyIntelligence as mongoose.Model<CompanyIntelligenceDocument>)
  : mongoose.model<CompanyIntelligenceDocument>('CompanyIntelligence', companyIntelligenceSchema);
