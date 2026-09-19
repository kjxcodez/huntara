import mongoose, { Schema } from 'mongoose';
import { generateEntityId } from '@huntara/schema';
import { workspacePlugin, type WorkspaceScopedDocument } from '../plugins/index.js';

export interface GoogleConnectionDocument extends mongoose.Document, WorkspaceScopedDocument {
  userId: string;
  googleAccountId: string; // Google stable sub identifier
  email: string;
  name?: string | null;
  picture?: string | null;
  encryptedRefreshToken: string;
  encryptedAccessToken?: string | null;
  tokenExpiresAt?: Date | null;
  grantedScopes: string[];
  gmailStatus: 'connected' | 'reauth_required' | 'revoked' | 'error';
  driveStatus: 'authorized' | 'not_authorized' | 'reauth_required' | 'revoked' | 'error';
  status: 'active' | 'reauth_required' | 'disconnected';
  lastVerifiedAt?: Date | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const googleConnectionSchema = new Schema<GoogleConnectionDocument>(
  {
    userId: { type: String, required: true },
    googleAccountId: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: null },
    picture: { type: String, default: null },
    encryptedRefreshToken: { type: String, required: true },
    encryptedAccessToken: { type: String, default: null },
    tokenExpiresAt: { type: Date, default: null },
    grantedScopes: { type: [String], default: [] },
    gmailStatus: {
      type: String,
      enum: ['connected', 'reauth_required', 'revoked', 'error'],
      default: 'connected'
    },
    driveStatus: {
      type: String,
      enum: ['authorized', 'not_authorized', 'reauth_required', 'revoked', 'error'],
      default: 'not_authorized'
    },
    status: {
      type: String,
      enum: ['active', 'reauth_required', 'disconnected'],
      default: 'active'
    },
    lastVerifiedAt: { type: Date, default: null },
    lastError: { type: String, default: null }
  },
  {
    timestamps: true,
    strict: true
  }
);

googleConnectionSchema.plugin(workspacePlugin);

// Unique compound index so a Google account cannot be connected twice in the same workspace
googleConnectionSchema.index({ workspaceId: 1, googleAccountId: 1 }, { unique: true });
googleConnectionSchema.index({ workspaceId: 1, email: 1 });
googleConnectionSchema.index({ workspaceId: 1, status: 1 });

export const GoogleConnectionModel = mongoose.models.GoogleConnection
  ? (mongoose.models.GoogleConnection as mongoose.Model<GoogleConnectionDocument>)
  : mongoose.model<GoogleConnectionDocument>('GoogleConnection', googleConnectionSchema);
