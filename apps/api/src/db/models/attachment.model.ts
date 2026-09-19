import mongoose, { Schema } from 'mongoose';
import { generateEntityId } from '@huntara/schema';
import { workspacePlugin, type WorkspaceScopedDocument } from '../plugins/index.js';

export interface AttachmentDocument extends mongoose.Document, WorkspaceScopedDocument {
  provider: 'google-drive';
  googleConnectionId: string;
  googleAccountId: string;
  fileId: string; // Google Drive fileId
  filename: string;
  mimeType: string;
  size: number;
  driveUrl?: string | null;
  thumbnailUrl?: string | null;
  contentHash?: string | null;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const attachmentSchema = new Schema<AttachmentDocument>(
  {
    provider: { type: String, enum: ['google-drive'], default: 'google-drive' },
    googleConnectionId: { type: String, required: true },
    googleAccountId: { type: String, required: true },
    fileId: { type: String, required: true },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    driveUrl: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },
    contentHash: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: () => ({}) }
  },
  {
    timestamps: true,
    strict: true
  }
);

attachmentSchema.plugin(workspacePlugin);

attachmentSchema.index({ workspaceId: 1, fileId: 1 });
attachmentSchema.index({ workspaceId: 1, googleConnectionId: 1 });
attachmentSchema.index({ workspaceId: 1, contentHash: 1 });
attachmentSchema.index({ workspaceId: 1, createdAt: -1 });

export const AttachmentModel = mongoose.models.Attachment
  ? (mongoose.models.Attachment as mongoose.Model<AttachmentDocument>)
  : mongoose.model<AttachmentDocument>('Attachment', attachmentSchema);
