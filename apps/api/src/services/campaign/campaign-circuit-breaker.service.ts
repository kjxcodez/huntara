/**
 * LeadForge OS — Campaign Outbound Rejection Circuit Breaker Service
 *
 * Atomically monitors recent outbound delivery rejections (e.g. spam blocks,
 * authentication/policy failures, and provider rate limits) for active campaigns.
 * If consecutive or window-based rejection thresholds are breached, this service
 * atomically transitions the authoritative MongoDB campaign record to PAUSED with
 * reason OUTBOUND_REJECTION_CIRCUIT_BREAKER, preventing further mailbox degradation.
 */

import { CampaignModel, type CampaignDocument } from '../../db/models/campaign.model.js';
import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { JobModel, SequenceExecutionModel } from '../../db/models/index.js';
import {
  CampaignStatus,
  CampaignPauseReason,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  evaluateCircuitBreaker,
  isCircuitBreakerRejectionCategory,
  type CampaignCircuitBreakerConfig,
  type CircuitBreakerEvaluation
} from '@leadforge/schema';
import { logger } from '../../config/index.js';

export interface BreakerEvaluationResult {
  tripped: boolean;
  reason?: string | undefined;
  evaluation?: CircuitBreakerEvaluation | undefined;
  campaign?: CampaignDocument | null | undefined;
}

export class CampaignCircuitBreakerService {
  constructor(private readonly workspaceId: string) {}

  /**
   * Evaluates the rolling rejection metrics for a campaign and atomically trips
   * the circuit breaker if the threshold is exceeded.
   *
   * Safety Invariants:
   * 1. Only transitions campaigns that are currently ACTIVE.
   * 2. Preserves USER_REQUESTED pauses, STOPPED, COMPLETED, or FAILED states.
   * 3. Uses atomic findOneAndUpdate to guarantee race safety across concurrent workers.
   * 4. Cancels queued jobs and pauses active sequence executions upon trip.
   */
  public async checkAndTripBreaker(
    workspaceId: string,
    campaignId: string,
    triggerDelivery?: {
      id?: string | undefined;
      failureCategory?: string | null | undefined;
      failureCode?: string | null | undefined;
      technicalMessage?: string | null | undefined;
    }
  ): Promise<BreakerEvaluationResult> {
    const wsId = workspaceId || this.workspaceId;
    if (!campaignId || !wsId) {
      return { tripped: false };
    }

    // 1. Authoritative check: campaign must exist and be currently ACTIVE
    const campaign = await CampaignModel.findOne({
      _id: campaignId,
      workspaceId: wsId
    });

    if (!campaign || campaign.status !== CampaignStatus.ACTIVE) {
      return { tripped: false };
    }

    // 2. Resolve campaign configuration
    const config: CampaignCircuitBreakerConfig = {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      ...((campaign.settings as any)?.circuitBreaker || {})
    };

    // 3. Determine time boundary for rolling window
    const now = Date.now();
    const windowStart = new Date(now - config.windowMs);
    const resumedAt = (campaign.settings as any)?.resumedAt
      ? new Date((campaign.settings as any).resumedAt)
      : null;
    const effectiveStart = resumedAt && resumedAt > windowStart ? resumedAt : windowStart;

    // 4. Query recent outbound deliveries in window (newest first)
    const recentDeliveries = await EmailDeliveryModel.find({
      workspaceId: wsId,
      campaignId,
      direction: 'OUTBOUND',
      status: { $in: ['SENT', 'FAILED'] },
      createdAt: { $gte: effectiveStart }
    })
      .sort({ createdAt: -1 })
      .limit(100);

    // 5. Evaluate pure circuit breaker rules
    const evaluation = evaluateCircuitBreaker(recentDeliveries as any, config);

    if (!evaluation.shouldTrip) {
      return {
        tripped: false,
        evaluation
      };
    }

    // 6. Atomically trip the breaker (conditional on status === ACTIVE)
    const trippedAt = new Date();
    const updated = await CampaignModel.findOneAndUpdate(
      {
        _id: campaignId,
        workspaceId: wsId,
        status: CampaignStatus.ACTIVE // Atomic check-and-set: prevents overwriting USER_REQUESTED or terminal states
      },
      {
        $set: {
          status: CampaignStatus.PAUSED,
          'settings.pauseReason': CampaignPauseReason.OUTBOUND_REJECTION_CIRCUIT_BREAKER,
          'settings.circuitBreakerTrippedAt': trippedAt.toISOString(),
          'settings.circuitBreakerTrigger': {
            reason: evaluation.reason,
            consecutiveRejections: evaluation.consecutiveRejections,
            windowRejections: evaluation.windowRejections,
            rejectionRate: Number(evaluation.rejectionRate.toFixed(3)),
            lastDeliveryId: triggerDelivery?.id || null,
            lastFailureCategory: triggerDelivery?.failureCategory || null,
            lastFailureCode: triggerDelivery?.failureCode || null,
            trippedAt: trippedAt.toISOString()
          },
          updatedAt: trippedAt
        }
      },
      { new: true }
    );

    if (!updated) {
      // Another worker or operator updated the campaign concurrently away from ACTIVE
      return {
        tripped: false,
        reason: 'Campaign was already paused or state changed concurrently'
      };
    }

    logger.warn(
      {
        workspaceId: wsId,
        campaignId,
        reason: evaluation.reason,
        consecutiveRejections: evaluation.consecutiveRejections,
        windowRejections: evaluation.windowRejections,
        rejectionRate: evaluation.rejectionRate
      },
      'Campaign outbound rejection circuit breaker TRIPPED: transitioned to PAUSED'
    );

    // 7. Cleanup in-flight queued jobs for this campaign
    try {
      await JobModel.updateMany(
        {
          workspaceId: wsId,
          status: { $in: ['queued', 'starting', 'running', 'retrying'] },
          'payload.campaignId': campaignId
        },
        { $set: { status: 'cancelled' } }
      );
    } catch (jobErr) {
      logger.warn({ jobErr, campaignId }, 'Circuit breaker: warning cancelling in-flight jobs');
    }

    // 8. Transition active sequence executions to PAUSED
    try {
      await SequenceExecutionModel.updateMany(
        {
          workspaceId: wsId,
          campaignId,
          status: { $in: ['PENDING', 'RUNNING', 'WAITING', 'active', 'running', 'waiting', 'pending'] }
        },
        {
          $set: {
            status: 'PAUSED',
            nextExecutionAt: null
          },
          $push: {
            logs: {
              timestamp: new Date(),
              level: 'warn',
              message: `Sequence execution paused: Campaign circuit breaker tripped (${evaluation.reason}).`
            }
          }
        }
      );
    } catch (execErr) {
      logger.warn({ execErr, campaignId }, 'Circuit breaker: warning pausing sequence executions');
    }

    return {
      tripped: true,
      reason: evaluation.reason,
      evaluation,
      campaign: updated
    };
  }
}
