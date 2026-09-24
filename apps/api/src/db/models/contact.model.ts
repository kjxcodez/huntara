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
import { ContactStatus, ContactEmailStatus, type ContactEmailMeta } from '@huntara/schema';

export interface ContactDocument
  extends
    mongoose.Document,
    SoftDeleteDocument,
    AuditDocument,
    TimestampDocument,
    WorkspaceScopedDocument {
  companyId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  linkedin?: string | null;
  linkedinUrl?: string | null;
  source?: string | null;
  status: ContactStatus;
  /**
   * Email validation lifecycle. QUARANTINED contacts are excluded from campaign outreach.
   * Defaults to UNVERIFIED for all new/imported contacts.
   */
  emailStatus?: ContactEmailStatus | null;
  emailMeta?: ContactEmailMeta | null;
  notes?: string | null;
  lastContactedAt?: Date | null;
}

const contactSchema = new Schema<ContactDocument>(
  {
    companyId: {
      type: String,
      default: null,
      index: true
    },
    firstName: {
      type: String,
      default: null,
      trim: true
    },
    lastName: {
      type: String,
      default: null,
      trim: true
    },
    email: {
      type: String,
      default: null,
      lowercase: true,
      trim: true
    },
    phone: {
      type: String,
      default: null,
      trim: true
    },
    title: {
      type: String,
      default: null,
      trim: true
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
    source: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: Object.values(ContactStatus),
      default: ContactStatus.NEW
    },
    emailStatus: {
      type: String,
      enum: Object.values(ContactEmailStatus),
      default: ContactEmailStatus.UNVERIFIED
    },
    emailMeta: {
      type: Schema.Types.Mixed,
      default: null
    },
    notes: {
      type: String,
      default: null
    },
    lastContactedAt: {
      type: Date,
      default: null
    }
  },
  {
    strict: true,
    optimisticConcurrency: true
  }
);

// Indexes
// 1. workspaceId + companyId (enables contact listing per company inside workspace)
contactSchema.index({ workspaceId: 1, companyId: 1 });
// 2. workspaceId + email (unique per workspace: email must be unique per tenant)
contactSchema.index(
  { workspaceId: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { email: { $type: 'string' } }
  }
);
// 3. workspaceId + createdAt (enables fast reverse-chronological sorting without in-memory sort buffer)
contactSchema.index({ workspaceId: 1, createdAt: -1 });

contactSchema.plugin(workspacePlugin);
contactSchema.plugin(softDeletePlugin);
contactSchema.plugin(auditPlugin);
contactSchema.plugin(timestampPlugin);

export const ContactModel = mongoose.models.Contact
  ? (mongoose.models.Contact as mongoose.Model<ContactDocument>)
  : mongoose.model<ContactDocument>('Contact', contactSchema);
