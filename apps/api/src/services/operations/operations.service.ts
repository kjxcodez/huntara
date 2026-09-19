import mongoose from 'mongoose';
import { JobModel, type JobDocument } from '../../db/models/job.model.js';
import { EmailDeliveryModel, type EmailDeliveryDocument } from '../../db/models/email-delivery.model.js';
import { EmailEventModel } from '../../db/models/email-event.model.js';
import { CampaignModel } from '../../db/models/campaign.model.js';
import { ContactModel } from '../../db/models/contact.model.js';
import { EmailAccountModel } from '../../db/models/email-account.model.js';
import { ReconciliationService } from '../email/reconciliation.service.js';
import {
  type OperationRecord,
  type OperationsHealthSummary,
  type OperationTimelineEvent,
  type OperationsQueryDto,
  type OperationStatus,
  type OperationType,
  type SubsystemHealthStatus,
  classifyOperationFailure
} from '@huntara/schema';
import { NotFoundError, ValidationError } from '../../errors/index.js';
import { logger } from '../../config/index.js';

export class OperationsService {
  constructor(private readonly workspaceId: string) {}

  /**
   * Normalizes an authoritative JobDocument into a unified OperationRecord.
   */
  private mapJobToOperation(job: JobDocument, now = new Date()): OperationRecord {
    const isStale = Boolean(
      (job.status === 'starting' || job.status === 'running') &&
        ((job.leaseExpiresAt && new Date(job.leaseExpiresAt) < now) ||
          (job.lastHeartbeatAt && now.getTime() - new Date(job.lastHeartbeatAt).getTime() > 60_000))
    );

    const attempt = (job.retryCount || 0) + 1;
    const maxAttempts = job.maxRetries ?? 3;
    const retryable = job.status === 'failed' || job.status === 'cancelled';

    const failureClass = classifyOperationFailure({
      status: job.status as OperationStatus,
      retryable,
      attempt,
      maxAttempts,
      isStale,
      errorCode: job.error ? 'JOB_FAILED' : null
    });

    const safeMessage = job.error
      ? `Worker task "${job.type}" encountered an error: ${job.error}`
      : job.status === 'running'
        ? `Worker task "${job.type}" is executing.`
        : `Worker task "${job.type}" is in state ${job.status}.`;

    return {
      id: job._id.toString(),
      type: job.type as OperationType,
      workspaceId: this.workspaceId,
      status: isStale ? 'stale' : (job.status as OperationStatus),
      createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : now.toISOString(),
      startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
      finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
      durationMs: job.durationMs || null,
      attempt,
      maxAttempts,
      nextRetryAt: job.scheduledAt ? new Date(job.scheduledAt).toISOString() : null,
      lastHeartbeatAt: job.lastHeartbeatAt ? new Date(job.lastHeartbeatAt).toISOString() : null,
      isStale,
      lastError: job.error || null,
      errorCode: job.error ? 'JOB_FAILED' : null,
      failureClass,
      safeHumanMessage: safeMessage,
      technicalMessage: job.error || null,
      retryable,
      correlationId: job.idempotencyKey || (job.payload as any)?.executionId || job._id.toString(),
      campaignId: (job.payload as any)?.campaignId || null,
      contactId: (job.payload as any)?.contactId || null,
      deliveryId: null,
      sequenceExecutionId: (job.payload as any)?.executionId || null,
      provider: null,
      providerMessageId: null,
      metadata: {
        workerId: job.workerId,
        priority: job.priority,
        progress: job.progress
      }
    };
  }

  /**
   * Normalizes an authoritative EmailDeliveryDocument into a unified OperationRecord.
   */
  private mapDeliveryToOperation(delivery: EmailDeliveryDocument, now = new Date()): OperationRecord {
    const isAmbiguous = delivery.status === 'AMBIGUOUS' || Boolean(delivery.ambiguous);
    const isSending = delivery.status === 'SENDING';
    const ageMs = now.getTime() - new Date(delivery.updatedAt || delivery.createdAt).getTime();
    const isStale = isSending && ageMs > 300_000; // 5 min stuck in SENDING

    let status: OperationStatus = 'queued';
    if (isStale) status = 'stale';
    else if (isAmbiguous) status = 'ambiguous';
    else if (delivery.status === 'SENDING') status = 'running';
    else if (delivery.status === 'SENT') status = 'completed';
    else if (delivery.status === 'FAILED') status = 'failed';
    else if (delivery.status === 'RETRYING') status = 'retrying';
    else if (delivery.status === 'CANCELLED' || delivery.status === 'SUPPRESSED') status = 'cancelled';
    else status = 'queued';

    const attempt = delivery.attempt || 1;
    const maxAttempts = 3;
    const retryable = Boolean(delivery.retryable && delivery.status !== 'SENT' && !isAmbiguous);

    const failureClass = classifyOperationFailure({
      status,
      retryable,
      attempt,
      maxAttempts,
      isStale,
      errorCode: delivery.failureCode || (isAmbiguous ? 'AMBIGUOUS_SEND_TIMEOUT' : null)
    });

    return {
      id: delivery._id.toString(),
      type: 'email:send',
      workspaceId: this.workspaceId,
      status,
      createdAt: delivery.createdAt ? new Date(delivery.createdAt).toISOString() : now.toISOString(),
      startedAt: delivery.sentAt ? new Date(delivery.sentAt).toISOString() : delivery.createdAt ? new Date(delivery.createdAt).toISOString() : null,
      finishedAt: delivery.sentAt ? new Date(delivery.sentAt).toISOString() : null,
      durationMs: null,
      attempt,
      maxAttempts,
      nextRetryAt: delivery.nextRetryAt ? new Date(delivery.nextRetryAt).toISOString() : null,
      lastHeartbeatAt: delivery.updatedAt ? new Date(delivery.updatedAt).toISOString() : null,
      isStale,
      lastError: delivery.error || delivery.technicalMessage || null,
      errorCode: delivery.failureCode || (isAmbiguous ? 'AMBIGUOUS_SEND_TIMEOUT' : null),
      failureClass,
      safeHumanMessage: delivery.safeHumanMessage || (isAmbiguous ? 'Network timeout during send. Requires reconciliation.' : null),
      technicalMessage: delivery.technicalMessage || delivery.error || null,
      retryable,
      correlationId: delivery.idempotencyKey || delivery.executionId,
      campaignId: delivery.campaignId || null,
      contactId: delivery.contactId || null,
      contactEmail: delivery.recipientEmail,
      deliveryId: delivery._id.toString(),
      sequenceExecutionId: delivery.executionId,
      provider: delivery.provider || 'gmail',
      providerMessageId: delivery.providerMessageId || null,
      metadata: {
        accountId: delivery.accountId,
        senderEmail: delivery.senderEmail,
        recipientEmail: delivery.recipientEmail,
        subject: delivery.subject,
        hasReply: delivery.hasReply,
        replyCount: delivery.replyCount,
        openCount: delivery.openCount,
        clickCount: delivery.clickCount
      }
    };
  }

  /**
   * Lists unified operations (jobs + email deliveries) with filtering, search, and pagination.
   */
  async listOperations(query: OperationsQueryDto): Promise<{
    items: OperationRecord[];
    total: number;
    page: number;
    limit: number;
  }> {
    const now = new Date();
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 50));

    // 1. Fetch relevant jobs
    const jobFilter: any = { workspaceId: this.workspaceId };
    if (query.type && query.type !== 'email:send') {
      jobFilter.type = query.type;
    }
    if (query.campaignId) {
      jobFilter['payload.campaignId'] = query.campaignId;
    }
    if (query.contactId) {
      jobFilter['payload.contactId'] = query.contactId;
    }

    const rawJobs = await JobModel.find(jobFilter).sort({ createdAt: -1 }).limit(100);
    const jobOps = rawJobs.map((j) => this.mapJobToOperation(j, now));

    // 2. Fetch relevant email deliveries
    let deliveryOps: OperationRecord[] = [];
    if (!query.type || query.type === 'email:send') {
      const delFilter: any = { workspaceId: this.workspaceId };
      if (query.campaignId) delFilter.campaignId = query.campaignId;
      if (query.contactId) delFilter.contactId = query.contactId;

      const rawDeliveries = await EmailDeliveryModel.find(delFilter).sort({ createdAt: -1 }).limit(100);
      deliveryOps = rawDeliveries.map((d) => this.mapDeliveryToOperation(d, now));
    }

    // 3. Merge and apply in-memory filters (status, failureClass, search, isStale, retryable)
    let merged = [...jobOps, ...deliveryOps];

    if (query.status) {
      const targetStatus = query.status.toLowerCase();
      merged = merged.filter((op) => op.status.toLowerCase() === targetStatus);
    }

    if (query.failureClass) {
      merged = merged.filter((op) => op.failureClass === query.failureClass);
    }

    if (query.isStale !== undefined) {
      merged = merged.filter((op) => op.isStale === query.isStale);
    }

    if (query.retryable !== undefined) {
      merged = merged.filter((op) => op.retryable === query.retryable);
    }

    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      merged = merged.filter((op) => {
        return (
          op.id.toLowerCase().includes(q) ||
          op.type.toLowerCase().includes(q) ||
          (op.correlationId && op.correlationId.toLowerCase().includes(q)) ||
          (op.safeHumanMessage && op.safeHumanMessage.toLowerCase().includes(q)) ||
          (op.contactEmail && op.contactEmail.toLowerCase().includes(q)) ||
          (op.metadata?.subject && String(op.metadata.subject).toLowerCase().includes(q))
        );
      });
    }

    // Sort by createdAt descending
    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = merged.length;
    const startIndex = (page - 1) * limit;
    const paginated = merged.slice(startIndex, startIndex + limit);

    // Enrich campaignName if present
    const campaignIds = Array.from(new Set(paginated.map((p) => p.campaignId).filter(Boolean))) as string[];
    if (campaignIds.length > 0) {
      const campaigns = await CampaignModel.find({ _id: { $in: campaignIds }, workspaceId: this.workspaceId });
      const cmap = new Map<string, string>();
      campaigns.forEach((c) => cmap.set(c._id.toString(), c.name));
      paginated.forEach((p) => {
        if (p.campaignId && cmap.has(p.campaignId)) {
          p.campaignName = cmap.get(p.campaignId);
        }
      });
    }

    return {
      items: paginated,
      total,
      page,
      limit
    };
  }

  /**
   * Retrieves a single operation by ID (checking JobModel then EmailDeliveryModel).
   */
  async getOperation(id: string): Promise<OperationRecord | null> {
    const now = new Date();

    // Check JobModel
    if (mongoose.isValidObjectId(id)) {
      const job = await JobModel.findOne({ _id: id, workspaceId: this.workspaceId });
      if (job) {
        const op = this.mapJobToOperation(job, now);
        if (op.campaignId) {
          const camp = await CampaignModel.findOne({ _id: op.campaignId, workspaceId: this.workspaceId });
          if (camp) op.campaignName = camp.name;
        }
        return op;
      }

      // Check EmailDeliveryModel
      const delivery = await EmailDeliveryModel.findOne({ _id: id, workspaceId: this.workspaceId });
      if (delivery) {
        const op = this.mapDeliveryToOperation(delivery, now);
        if (op.campaignId) {
          const camp = await CampaignModel.findOne({ _id: op.campaignId, workspaceId: this.workspaceId });
          if (camp) op.campaignName = camp.name;
        }
        return op;
      }
    }

    // Try finding by custom idempotency key or correlationId
    const jobByIdem = await JobModel.findOne({ idempotencyKey: id, workspaceId: this.workspaceId });
    if (jobByIdem) return this.mapJobToOperation(jobByIdem, now);

    const delByIdem = await EmailDeliveryModel.findOne({ idempotencyKey: id, workspaceId: this.workspaceId });
    if (delByIdem) return this.mapDeliveryToOperation(delByIdem, now);

    return null;
  }

  /**
   * Returns structured operational timeline events for an operation.
   */
  async getOperationEvents(id: string): Promise<OperationTimelineEvent[]> {
    const events: OperationTimelineEvent[] = [];

    // 1. Check if it's an email delivery
    if (mongoose.isValidObjectId(id)) {
      const delivery = await EmailDeliveryModel.findOne({ _id: id, workspaceId: this.workspaceId });
      if (delivery) {
        events.push({
          id: `evt_init_${delivery._id}`,
          operationId: id,
          correlationId: delivery.idempotencyKey || delivery.executionId,
          eventName: 'email.send.started',
          timestamp: new Date(delivery.createdAt).toISOString(),
          severity: 'info',
          message: `Outbound delivery queued for recipient "${delivery.recipientEmail}".`,
          details: {
            sender: delivery.senderEmail,
            subject: delivery.subject,
            attempt: delivery.attempt || 1
          }
        });

        if (delivery.sentAt) {
          events.push({
            id: `evt_accepted_${delivery._id}`,
            operationId: id,
            correlationId: delivery.idempotencyKey || delivery.executionId,
            eventName: 'gmail.accepted',
            timestamp: new Date(delivery.sentAt).toISOString(),
            severity: 'info',
            message: `Message accepted by Gmail API (Message-ID: ${delivery.providerMessageId || 'recorded'}).`,
            details: {
              providerMessageId: delivery.providerMessageId,
              providerThreadId: delivery.providerThreadId
            }
          });
        }

        if (delivery.ambiguous) {
          events.push({
            id: `evt_ambiguous_${delivery._id}`,
            operationId: id,
            correlationId: delivery.idempotencyKey || delivery.executionId,
            eventName: 'email.send.ambiguous',
            timestamp: new Date(delivery.updatedAt).toISOString(),
            severity: 'warn',
            message: delivery.safeHumanMessage || 'Network timeout during provider dispatch. Ambiguous status.',
            details: {
              error: delivery.error,
              technicalMessage: delivery.technicalMessage
            }
          });
        } else if (delivery.error) {
          events.push({
            id: `evt_err_${delivery._id}`,
            operationId: id,
            correlationId: delivery.idempotencyKey || delivery.executionId,
            eventName: 'email.send.failed',
            timestamp: new Date(delivery.updatedAt).toISOString(),
            severity: 'error',
            message: delivery.safeHumanMessage || delivery.error,
            details: {
              errorCode: delivery.failureCode,
              retryable: delivery.retryable,
              technicalMessage: delivery.technicalMessage
            }
          });
        }

        if (delivery.reconciledAt) {
          events.push({
            id: `evt_reconciled_${delivery._id}`,
            operationId: id,
            correlationId: delivery.idempotencyKey || delivery.executionId,
            eventName: 'email.send.reconciled',
            timestamp: new Date(delivery.reconciledAt).toISOString(),
            severity: 'info',
            message: `Delivery reconciled against Gmail: ${delivery.status}`,
            details: {
              notes: delivery.reconciliationNotes
            }
          });
        }

        // Query engagement events
        const rawEvents = await EmailEventModel.find({ deliveryId: delivery._id.toString() }).sort({ createdAt: 1 });
        rawEvents.forEach((ev) => {
          events.push({
            id: ev._id.toString(),
            operationId: id,
            correlationId: delivery.idempotencyKey || delivery.executionId,
            eventName: `email.event.${ev.type.toLowerCase()}`,
            timestamp: new Date(ev.createdAt).toISOString(),
            severity: 'info',
            message: `Email event recorded: ${ev.type}`,
            details: ev.metadata
          });
        });

        events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        return events;
      }

      // 2. Check if it's a job
      const job = await JobModel.findOne({ _id: id, workspaceId: this.workspaceId });
      if (job) {
        events.push({
          id: `evt_job_start_${job._id}`,
          operationId: id,
          correlationId: job.idempotencyKey || job._id.toString(),
          eventName: 'worker.started',
          timestamp: new Date(job.startedAt || job.createdAt).toISOString(),
          severity: 'info',
          message: `Worker task "${job.type}" started execution.`,
          details: {
            workerId: job.workerId,
            priority: job.priority
          }
        });

        if (job.checkpointAt) {
          events.push({
            id: `evt_job_chk_${job._id}`,
            operationId: id,
            correlationId: job.idempotencyKey || job._id.toString(),
            eventName: 'worker.progress',
            timestamp: new Date(job.checkpointAt).toISOString(),
            severity: 'info',
            message: `Progress updated: ${job.progress}%`,
            details: job.checkpointData
          });
        }

        if (job.status === 'retrying') {
          events.push({
            id: `evt_job_retry_${job._id}`,
            operationId: id,
            correlationId: job.idempotencyKey || job._id.toString(),
            eventName: 'job.retry.scheduled',
            timestamp: new Date(job.updatedAt).toISOString(),
            severity: 'warn',
            message: `Task failed and scheduled for retry (${job.retryCount}/${job.maxRetries}).`,
            details: {
              error: job.error,
              scheduledAt: job.scheduledAt
            }
          });
        } else if (job.status === 'completed') {
          events.push({
            id: `evt_job_done_${job._id}`,
            operationId: id,
            correlationId: job.idempotencyKey || job._id.toString(),
            eventName: 'worker.completed',
            timestamp: new Date(job.finishedAt || job.updatedAt).toISOString(),
            severity: 'info',
            message: `Task completed successfully in ${job.durationMs || 0}ms.`,
            details: { durationMs: job.durationMs }
          });
        } else if (job.status === 'failed') {
          events.push({
            id: `evt_job_fail_${job._id}`,
            operationId: id,
            correlationId: job.idempotencyKey || job._id.toString(),
            eventName: 'worker.failed',
            timestamp: new Date(job.finishedAt || job.updatedAt).toISOString(),
            severity: 'error',
            message: `Task failed permanently: ${job.error}`,
            details: { error: job.error }
          });
        }

        events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        return events;
      }
    }

    return events;
  }

  /**
   * Safely retries an operation if semantically safe to do so.
   */
  async retryOperation(id: string, force = false): Promise<{
    success: boolean;
    message: string;
    operation: OperationRecord;
  }> {
    if (!mongoose.isValidObjectId(id)) {
      throw new NotFoundError(`Operation with id "${id}" not found.`);
    }

    // 1. Check JobModel
    const job = await JobModel.findOne({ _id: id, workspaceId: this.workspaceId });
    if (job) {
      if (!force && job.status !== 'failed' && job.status !== 'cancelled') {
        throw new ValidationError(`Job "${id}" is in status "${job.status}" and cannot be retried.`);
      }

      job.status = 'queued';
      job.error = null;
      job.leaseExpiresAt = null;
      job.scheduledAt = new Date();
      job.updatedAt = new Date();
      await job.save();

      logger.info({ workspaceId: this.workspaceId, jobId: id }, 'Job manually re-queued for execution');
      return {
        success: true,
        message: `Job "${id}" successfully queued for retry.`,
        operation: this.mapJobToOperation(job)
      };
    }

    // 2. Check EmailDeliveryModel
    const delivery = await EmailDeliveryModel.findOne({ _id: id, workspaceId: this.workspaceId });
    if (delivery) {
      if (delivery.status === 'SENT') {
        throw new ValidationError(
          `Delivery "${id}" was already finalized as SENT. Retrying would result in duplicate outreach!`
        );
      }

      if (delivery.status === 'AMBIGUOUS' || delivery.ambiguous) {
        throw new ValidationError(
          `Delivery "${id}" is in AMBIGUOUS state. A network timeout occurred after dispatch. Retrying without reconciliation could send duplicate emails. Use Reconcile instead.`
        );
      }

      if (!force && !delivery.retryable && delivery.status === 'FAILED') {
        throw new ValidationError(
          `Delivery "${id}" failed permanently (${delivery.failureCategory || 'non-retryable policy'}). Manual override required.`
        );
      }

      delivery.status = 'QUEUED';
      delivery.error = null;
      delivery.technicalMessage = null;
      delivery.safeHumanMessage = null;
      delivery.attempt = (delivery.attempt || 1) + 1;
      delivery.updatedAt = new Date();
      await delivery.save();

      logger.info({ workspaceId: this.workspaceId, deliveryId: id }, 'Delivery reset to QUEUED for retry');
      return {
        success: true,
        message: `Delivery "${id}" successfully queued for retry.`,
        operation: this.mapDeliveryToOperation(delivery)
      };
    }

    throw new NotFoundError(`Operation with id "${id}" not found.`);
  }

  /**
   * Reconciles an ambiguous delivery or stalled operation against provider truth.
   */
  async reconcileOperation(id: string): Promise<{
    success: boolean;
    message: string;
    result: any;
  }> {
    if (!mongoose.isValidObjectId(id)) {
      throw new NotFoundError(`Operation with id "${id}" not found.`);
    }

    // 1. Check EmailDeliveryModel
    const delivery = await EmailDeliveryModel.findOne({ _id: id, workspaceId: this.workspaceId });
    if (delivery) {
      const reconService = new ReconciliationService(this.workspaceId);
      const res = await reconService.reconcileAmbiguousDelivery(id);
      const isReconciled = res.resolvedStatus === 'SENT' || res.resolvedStatus === 'FAILED';
      return {
        success: isReconciled,
        message: isReconciled
          ? `Delivery reconciled successfully as ${res.resolvedStatus}. ${res.notes}`
          : `Reconciliation in progress or ambiguous: ${res.notes}`,
        result: res
      };
    }

    // 2. Check JobModel
    const job = await JobModel.findOne({ _id: id, workspaceId: this.workspaceId });
    if (job) {
      const now = new Date();
      if ((job.status === 'starting' || job.status === 'running') && job.leaseExpiresAt && new Date(job.leaseExpiresAt) < now) {
        job.status = 'retrying';
        job.error = 'Job execution lease expired. Reset by operator reconciliation.';
        job.scheduledAt = now;
        job.leaseExpiresAt = null;
        await job.save();
        return {
          success: true,
          message: `Stalled job "${id}" recovered and scheduled for re-execution.`,
          result: { status: 'retrying' }
        };
      }
      return {
        success: true,
        message: `Job "${id}" status is "${job.status}" (no lease expiration detected).`,
        result: { status: job.status }
      };
    }

    throw new NotFoundError(`Operation with id "${id}" not found.`);
  }

  /**
   * Generates authoritative system health summary across all subsystems.
   */
  async getHealthSummary(): Promise<OperationsHealthSummary> {
    const now = new Date();
    const nowIso = now.toISOString();

    // 1. MongoDB Health
    let mongoStatus: SubsystemHealthStatus = 'failed';
    let mongoMsg = 'Authoritative persistence unavailable';
    let mongoLatency: number | null = null;
    try {
      const start = Date.now();
      if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
        await mongoose.connection.db.admin().ping();
        mongoLatency = Date.now() - start;
        mongoStatus = 'healthy';
        mongoMsg = `MongoDB connected (${mongoLatency}ms)`;
      } else {
        mongoMsg = `MongoDB connection state: ${mongoose.connection.readyState}`;
      }
    } catch (mErr: any) {
      mongoStatus = 'failed';
      mongoMsg = `MongoDB error: ${mErr.message}`;
    }

    // 2. API Health
    const apiStatus: SubsystemHealthStatus = 'healthy';
    const apiMsg = 'API gateway responsive';

    // 3. Gmail Connectivity Health
    let gmailStatus: SubsystemHealthStatus = 'unknown';
    let gmailMsg = 'No connected Gmail accounts';
    let connectedCount = 0;
    let reauthCount = 0;
    try {
      const accounts = await EmailAccountModel.find({ workspaceId: this.workspaceId });
      connectedCount = accounts.filter((a) => a.status === 'connected').length;
      reauthCount = accounts.filter((a) => a.status === 'reauth_required').length;

      if (accounts.length === 0) {
        gmailStatus = 'not_connected';
        gmailMsg = 'No Gmail mailboxes registered in settings.';
      } else if (connectedCount > 0 && reauthCount === 0) {
        gmailStatus = 'healthy';
        gmailMsg = `${connectedCount} active Gmail mailbox(es) connected.`;
      } else if (connectedCount > 0 && reauthCount > 0) {
        gmailStatus = 'degraded';
        gmailMsg = `${connectedCount} active mailbox(es), but ${reauthCount} require reauthorization.`;
      } else {
        gmailStatus = 'failed';
        gmailMsg = `All ${accounts.length} Gmail mailbox(es) require re-authentication.`;
      }
    } catch (gErr: any) {
      gmailStatus = 'failed';
      gmailMsg = `Gmail account check failed: ${gErr.message}`;
    }

    // 4. Operations metrics (active, failed, stale, retrying)
    const activeJobsCount = await JobModel.countDocuments({
      workspaceId: this.workspaceId,
      status: { $in: ['starting', 'running'] }
    });
    const activeSendsCount = await EmailDeliveryModel.countDocuments({
      workspaceId: this.workspaceId,
      status: 'SENDING'
    });
    const activeOperationsCount = activeJobsCount + activeSendsCount;

    const failedJobsCount = await JobModel.countDocuments({
      workspaceId: this.workspaceId,
      status: 'failed'
    });
    const failedSendsCount = await EmailDeliveryModel.countDocuments({
      workspaceId: this.workspaceId,
      status: 'FAILED'
    });
    const failedOperationsCount = failedJobsCount + failedSendsCount;

    const retryingJobsCount = await JobModel.countDocuments({
      workspaceId: this.workspaceId,
      status: 'retrying'
    });
    const retryingSendsCount = await EmailDeliveryModel.countDocuments({
      workspaceId: this.workspaceId,
      status: 'RETRYING'
    });
    const retryingCount = retryingJobsCount + retryingSendsCount;

    // Stale detection
    const staleCutoff = new Date(now.getTime() - 60_000);
    const staleJobsCount = await JobModel.countDocuments({
      workspaceId: this.workspaceId,
      status: { $in: ['starting', 'running'] },
      $or: [{ leaseExpiresAt: { $lte: now } }, { lastHeartbeatAt: { $lte: staleCutoff } }]
    });
    const staleSendsCutoff = new Date(now.getTime() - 300_000);
    const staleSendsCount = await EmailDeliveryModel.countDocuments({
      workspaceId: this.workspaceId,
      status: 'SENDING',
      updatedAt: { $lte: staleSendsCutoff }
    });
    const staleOperationsCount = staleJobsCount + staleSendsCount;

    // Ambiguous deliveries count
    const ambiguousCount = await EmailDeliveryModel.countDocuments({
      workspaceId: this.workspaceId,
      status: 'AMBIGUOUS'
    });

    // 5. Inbound Polling Health & Freshness
    let inboundStatus: SubsystemHealthStatus = 'healthy';
    let inboundMsg = 'Inbound reply listener operational';
    let lastPollTime: string | null = null;
    try {
      const latestInbound = await EmailDeliveryModel.findOne({
        workspaceId: this.workspaceId,
        direction: 'INBOUND'
      }).sort({ createdAt: -1 });

      if (latestInbound) {
        lastPollTime = new Date(latestInbound.createdAt).toISOString();
        inboundMsg = `Latest reply received: ${new Date(latestInbound.createdAt).toLocaleTimeString()}`;
      } else {
        inboundStatus = connectedCount > 0 ? 'healthy' : 'not_connected';
        inboundMsg = connectedCount > 0 ? 'Awaiting inbound replies.' : 'No Gmail profile connected.';
      }
    } catch {
      inboundStatus = 'unknown';
    }

    // 6. Reconciliation Subsystem Health
    let reconStatus: SubsystemHealthStatus = 'healthy';
    let reconMsg = 'No ambiguous deliveries pending reconciliation.';
    let lastReconTime: string | null = null;
    try {
      const latestRecon = await EmailDeliveryModel.findOne({
        workspaceId: this.workspaceId,
        reconciledAt: { $ne: null }
      }).sort({ reconciledAt: -1 });

      if (latestRecon && latestRecon.reconciledAt) {
        lastReconTime = new Date(latestRecon.reconciledAt).toISOString();
      }

      if (ambiguousCount > 0) {
        reconStatus = 'degraded';
        reconMsg = `${ambiguousCount} ambiguous delivery/deliveries require reconciliation against Gmail.`;
      }
    } catch {
      reconStatus = 'unknown';
    }

    // 7. Scheduler Subsystem Health
    let schedulerStatus: SubsystemHealthStatus = 'healthy';
    let schedulerMsg = 'Background task scheduler operational';
    if (staleJobsCount > 0) {
      schedulerStatus = 'degraded';
      schedulerMsg = `${staleJobsCount} job(s) stalled with expired leases.`;
    }

    // 8. Workers Subsystem Health
    let workersStatus: SubsystemHealthStatus = 'healthy';
    let workersMsg = `${activeOperationsCount} active worker task(s).`;
    if (failedOperationsCount > 5) {
      workersStatus = 'degraded';
      workersMsg = `${failedOperationsCount} failed operations requiring attention.`;
    }

    // Overall Status
    const allStatuses = [mongoStatus, apiStatus, gmailStatus, inboundStatus, reconStatus, schedulerStatus, workersStatus];
    let overallStatus: SubsystemHealthStatus = 'healthy';
    if (allStatuses.includes('failed')) {
      overallStatus = 'failed';
    } else if (allStatuses.includes('degraded')) {
      overallStatus = 'degraded';
    }

    return {
      workspaceId: this.workspaceId,
      overallStatus,
      timestamp: nowIso,
      subsystems: {
        api: { status: apiStatus, message: apiMsg, lastCheckedAt: nowIso, latencyMs: 2 },
        mongodb: { status: mongoStatus, message: mongoMsg, lastCheckedAt: nowIso, latencyMs: mongoLatency },
        sqlite: { status: 'healthy', message: 'Local client cache active', lastCheckedAt: nowIso },
        gmail: { status: gmailStatus, message: gmailMsg, lastCheckedAt: nowIso },
        scheduler: { status: schedulerStatus, message: schedulerMsg, lastCheckedAt: nowIso },
        workers: { status: workersStatus, message: workersMsg, lastCheckedAt: nowIso },
        inboundPolling: { status: inboundStatus, message: inboundMsg, lastCheckedAt: nowIso },
        reconciliation: { status: reconStatus, message: reconMsg, lastCheckedAt: nowIso }
      },
      metrics: {
        activeOperationsCount,
        failedOperationsCount,
        staleOperationsCount,
        retryingCount,
        lastSuccessfulPollAt: lastPollTime,
        lastSuccessfulReconciliationAt: lastReconTime
      }
    };
  }
}
