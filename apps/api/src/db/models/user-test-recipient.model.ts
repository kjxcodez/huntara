import mongoose, { Schema } from 'mongoose';
import { generateEntityId } from '@huntara/schema';

export interface UserTestRecipientDocument extends mongoose.Document<string> {
  _id: string;
  userId: string;
  email: string;
  firstUsedAt: Date;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userTestRecipientSchema = new Schema<UserTestRecipientDocument>(
  {
    _id: { type: String, required: true, default: () => generateEntityId() },
    userId: { type: String, required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    firstUsedAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: Date.now }
  },
  {
    timestamps: true,
    strict: true
  }
);

// Compound unique index enforcing (userId, email) uniqueness
userTestRecipientSchema.index({ userId: 1, email: 1 }, { unique: true });

export const UserTestRecipientModel = mongoose.models.UserTestRecipient
  ? (mongoose.models.UserTestRecipient as mongoose.Model<UserTestRecipientDocument>)
  : mongoose.model<UserTestRecipientDocument>('UserTestRecipient', userTestRecipientSchema);
