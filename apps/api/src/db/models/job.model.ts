import mongoose, { Schema } from 'mongoose';
import {
  workspacePlugin,
  type WorkspaceScopedDocument
} from '../plugins/index.js';
import type { JobStatus } from '@huntara/schema';

export interface JobDocument extends mongoose.Document, WorkspaceScopedDocument {
  type: string;
  status: JobStatus;
  priority: number;
  payload: Record<string, any>;
  progress: number;
  retryCount: number;
  maxRetries: number;
  workerId?: string | null;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  scheduledAt?: Date | null;
  checkpointData?: Record<string, any> | null;
  checkpointAt?: Date | null;
  idempotencyKey?: string | null;
  durationMs?: number | null;
  leaseExpiresAt?: Date | null;
  lastHeartbeatAt?: Date | null;
  recoveryCount?: number;
  isDeadLetter?: boolean;
  deadLetteredAt?: Date | null;
  deadLetterReason?: string | null;
  lineageReferences?: {
    campaignId?: string | null;
    executionId?: string | null;
    contactId?: string | null;
    accountId?: string | null;
    failureCategory?: string | null;
    lastError?: string | null;
    attemptCount?: number | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new Schema<JobDocument>(
  {
    type: { type: String, required: true, trim: true, index: true },
    status: {
      type: String,
      required: true,
      enum: [
        'pending',
        'queued',
        'starting',
        'running',
        'waiting',
        'retrying',
        'paused',
        'cancelled',
        'completed',
        'failed',
        'interrupted'
      ],
      default: 'queued',
      index: true
    },
    priority: { type: Number, required: true, default: 1, min: 1, max: 10 },
    payload: { type: Schema.Types.Mixed, default: {} },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    workerId: { type: String, default: null, index: true },
    error: { type: String, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    scheduledAt: { type: Date, default: null, index: true },
    checkpointData: { type: Schema.Types.Mixed, default: null },
    checkpointAt: { type: Date, default: null },
    idempotencyKey: { type: String, default: null },
    durationMs: { type: Number, default: null },
    leaseExpiresAt: { type: Date, default: null, index: true },
    lastHeartbeatAt: { type: Date, default: null },
    recoveryCount: { type: Number, default: 0 },
    isDeadLetter: { type: Boolean, default: false, index: true },
    deadLetteredAt: { type: Date, default: null },
    deadLetterReason: { type: String, default: null },
    lineageReferences: {
      type: new Schema(
        {
          campaignId: { type: String, default: null },
          executionId: { type: String, default: null },
          contactId: { type: String, default: null },
          accountId: { type: String, default: null },
          failureCategory: { type: String, default: null },
          lastError: { type: String, default: null },
          attemptCount: { type: Number, default: 0 }
        },
        { _id: false }
      ),
      default: null
    }
  },
  {
    strict: true,
    timestamps: true
  }
);

// Strategic Indexes:
// 1. Worker claim index: find queued jobs ordered by priority descending, createdAt ascending
jobSchema.index({ workspaceId: 1, status: 1, priority: -1, createdAt: 1 });
// 2. Scheduled jobs check
jobSchema.index({ workspaceId: 1, scheduledAt: 1, status: 1 });
// 3. Stale lease recovery index
jobSchema.index({ workspaceId: 1, status: 1, leaseExpiresAt: 1 });
// 4. Dead-letter index
jobSchema.index({ workspaceId: 1, isDeadLetter: 1, createdAt: -1 });
// 5. Partial unique index for idempotency keys per workspace
jobSchema.index(
  { workspaceId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

jobSchema.plugin(workspacePlugin);

export const JobModel = mongoose.models.Job
  ? (mongoose.models.Job as mongoose.Model<JobDocument>)
  : mongoose.model<JobDocument>('Job', jobSchema);
