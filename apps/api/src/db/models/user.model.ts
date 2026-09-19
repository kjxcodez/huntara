import mongoose, { Schema } from 'mongoose';
import { generateEntityId } from '@huntara/schema';
import {
  softDeletePlugin,
  auditPlugin,
  timestampPlugin,
  type SoftDeleteDocument,
  type AuditDocument,
  type TimestampDocument
} from '../plugins/index.js';

export interface UserDocument
  extends mongoose.Document<any>, SoftDeleteDocument, AuditDocument, TimestampDocument {
  _id: string;
  email: string;
  passwordHash?: string | null;
  name: string;
  displayName: string;
  image?: string | null;
  avatar?: string | null;
  role: 'ADMIN' | 'MEMBER' | 'OWNER';
  activeWorkspaceId?: string | null;
  emailVerified: boolean;
  lastLoginAt?: Date | null;
  status: 'active' | 'suspended' | 'pending';
}

const userSchema = new Schema<UserDocument>(
  {
    _id: {
      type: String,
      required: true,
      default: () => generateEntityId()
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    passwordHash: {
      type: String,
      default: null
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    displayName: {
      type: String,
      trim: true,
      default: function (this: any) {
        return this.name || '';
      }
    },
    image: {
      type: String,
      default: null
    },
    avatar: {
      type: String,
      default: null
    },
    role: {
      type: String,
      enum: ['ADMIN', 'MEMBER', 'OWNER'],
      default: 'MEMBER'
    },
    activeWorkspaceId: {
      type: String,
      default: null
    },
    lastLoginAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'pending'],
      default: 'active'
    },
    emailVerified: {
      type: Boolean,
      default: false
    }
  },
  {
    strict: true,
    optimisticConcurrency: true
  }
);

userSchema.plugin(softDeletePlugin);
userSchema.plugin(auditPlugin);
userSchema.plugin(timestampPlugin);

export const UserModel = mongoose.models.User
  ? (mongoose.models.User as mongoose.Model<UserDocument>)
  : mongoose.model<UserDocument>('User', userSchema);
