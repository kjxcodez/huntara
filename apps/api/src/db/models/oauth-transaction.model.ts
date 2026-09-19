import mongoose, { Schema } from 'mongoose';
import { generateEntityId } from '@huntara/schema';

export interface OAuthTransactionDocument extends mongoose.Document<string> {
  _id: string;
  transactionId: string;
  workspaceId: string;
  userId: string;
  state: string;
  codeVerifier: string;
  provider: string;
  status: 'pending' | 'completed' | 'failed';
  emailAccountId?: string | null;
  error?: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const oauthTransactionSchema = new Schema<OAuthTransactionDocument>(
  {
    _id: { type: String, required: true, default: () => generateEntityId() },
    transactionId: { type: String, required: true, unique: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    state: { type: String, required: true, unique: true, index: true },
    codeVerifier: { type: String, required: true },
    provider: { type: String, required: true, default: 'gmail' },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'pending'
    },
    emailAccountId: { type: String, default: null },
    error: { type: String, default: null },
    expiresAt: { type: Date, required: true, expires: 0 }
  },
  {
    timestamps: true,
    strict: true
  }
);

export const OAuthTransactionModel = mongoose.models.OAuthTransaction
  ? (mongoose.models.OAuthTransaction as mongoose.Model<OAuthTransactionDocument>)
  : mongoose.model<OAuthTransactionDocument>('OAuthTransaction', oauthTransactionSchema);
