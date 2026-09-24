import mongoose, { Schema } from 'mongoose';
import {
  workspacePlugin,
  timestampPlugin,
  type WorkspaceScopedDocument,
  type TimestampDocument
} from '../plugins/index.js';

export interface CompanyDiscoveryRunDocument
  extends mongoose.Document,
    WorkspaceScopedDocument,
    TimestampDocument {
  companyId: string;
  discoveryRunId: string;
  requiresReview?: boolean;
}

const companyDiscoveryRunSchema = new Schema<CompanyDiscoveryRunDocument>(
  {
    companyId: {
      type: String,
      required: true,
      index: true
    },
    discoveryRunId: {
      type: String,
      required: true,
      index: true
    },
    requiresReview: {
      type: Boolean,
      default: false
    }
  },
  {
    strict: true,
    timestamps: true
  }
);

companyDiscoveryRunSchema.index({ workspaceId: 1, companyId: 1, discoveryRunId: 1 }, { unique: true });
companyDiscoveryRunSchema.index({ workspaceId: 1, discoveryRunId: 1 });
companyDiscoveryRunSchema.index({ workspaceId: 1, discoveryRunId: 1, companyId: 1 });
companyDiscoveryRunSchema.plugin(workspacePlugin);
companyDiscoveryRunSchema.plugin(timestampPlugin);

export const CompanyDiscoveryRunModel = mongoose.models.CompanyDiscoveryRun
  ? (mongoose.models.CompanyDiscoveryRun as mongoose.Model<CompanyDiscoveryRunDocument>)
  : mongoose.model<CompanyDiscoveryRunDocument>('CompanyDiscoveryRun', companyDiscoveryRunSchema);

export { companyDiscoveryRunSchema };
