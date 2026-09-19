import mongoose, { Schema } from 'mongoose';
import {
  workspacePlugin,
  timestampPlugin,
  type WorkspaceScopedDocument,
  type TimestampDocument
} from '../plugins/index.js';
import type { ContactSeniority } from '@huntara/schema';

export interface ContactIntelligenceDocument
  extends mongoose.Document,
    WorkspaceScopedDocument,
    TimestampDocument {
  contactId: string;
  decisionMakerScore?: number | null;
  seniority: ContactSeniority;
  buyingInfluence?: string | null;
  personalizationOpportunities: string[];
  relationshipStrength?: number | null;
}

const contactIntelligenceSchema = new Schema<ContactIntelligenceDocument>(
  {
    contactId: {
      type: String,
      required: true,
      index: true
    },
    decisionMakerScore: { type: Number, default: null, min: 0, max: 1 },
    seniority: {
      type: String,
      enum: ['C_LEVEL', 'VP', 'DIRECTOR', 'MANAGER', 'INDIVIDUAL_CONTRIBUTOR', 'UNKNOWN'],
      default: 'UNKNOWN'
    },
    buyingInfluence: { type: String, default: null },
    personalizationOpportunities: { type: [String], default: [] },
    relationshipStrength: { type: Number, default: null, min: 0, max: 1 }
  },
  {
    strict: true
  }
);

contactIntelligenceSchema.index({ workspaceId: 1, contactId: 1 }, { unique: true });

contactIntelligenceSchema.plugin(workspacePlugin);
contactIntelligenceSchema.plugin(timestampPlugin);

export const ContactIntelligenceModel = mongoose.models.ContactIntelligence
  ? (mongoose.models.ContactIntelligence as mongoose.Model<ContactIntelligenceDocument>)
  : mongoose.model<ContactIntelligenceDocument>('ContactIntelligence', contactIntelligenceSchema);
