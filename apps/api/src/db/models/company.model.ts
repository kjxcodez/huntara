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

export interface CompanyDocument
  extends
    mongoose.Document,
    SoftDeleteDocument,
    AuditDocument,
    TimestampDocument,
    WorkspaceScopedDocument {
  name: string;
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  size?: string | null; // Employee range e.g. "11-50"
  employeeCount?: number | null;
  revenue?: string | null;
  linkedin?: string | null;
  linkedinUrl?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  status: 'LEAD' | 'QUALIFIED' | 'CUSTOMER' | 'ARCHIVED';
  tags: string[];
  notes?: string | null;
  opportunityScore?: number | null;
}

const companySchema = new Schema<CompanyDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    domain: {
      type: String,
      default: null,
      trim: true,
      lowercase: true
    },
    website: {
      type: String,
      default: null,
      trim: true
    },
    industry: {
      type: String,
      default: null,
      trim: true
    },
    size: {
      type: String,
      default: null
    },
    employeeCount: {
      type: Number,
      default: null
    },
    revenue: {
      type: String,
      default: null
    },
    linkedin: {
      type: String,
      default: null,
      trim: true
    },
    linkedinUrl: {
      type: String,
      default: null,
      trim: true
    },
    location: {
      type: String,
      default: null,
      trim: true
    },
    city: {
      type: String,
      default: null,
      trim: true
    },
    state: {
      type: String,
      default: null,
      trim: true
    },
    country: {
      type: String,
      default: null,
      trim: true
    },
    status: {
      type: String,
      enum: ['LEAD', 'QUALIFIED', 'CUSTOMER', 'ARCHIVED'],
      default: 'LEAD'
    },
    tags: {
      type: [String],
      default: []
    },
    notes: {
      type: String,
      default: null
    },
    opportunityScore: {
      type: Number,
      default: null
    }
  },
  {
    strict: true,
    optimisticConcurrency: true
  }
);

// Indexes
// 1. workspaceId + domain (enables workspace-level search and validation)
companySchema.index({ workspaceId: 1, domain: 1 });
// 2. workspaceId + status (enables fast tenant filtering by pipeline status)
companySchema.index({ workspaceId: 1, status: 1 });
// 3. workspaceId + createdAt (enables fast reverse-chronological sorting without in-memory sort buffer)
companySchema.index({ workspaceId: 1, createdAt: -1 });

companySchema.plugin(workspacePlugin);
companySchema.plugin(softDeletePlugin);
companySchema.plugin(auditPlugin);
companySchema.plugin(timestampPlugin);

export const CompanyModel = mongoose.models.Company
  ? (mongoose.models.Company as mongoose.Model<CompanyDocument>)
  : mongoose.model<CompanyDocument>('Company', companySchema);
