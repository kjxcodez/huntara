import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CampaignCircuitBreakerService } from './campaign-circuit-breaker.service.js';
import { CampaignModel } from '../../db/models/campaign.model.js';
import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { JobModel, SequenceExecutionModel } from '../../db/models/index.js';
import {
  CampaignStatus,
  CampaignPauseReason,
  EmailFailureCategory,
  isCircuitBreakerRejectionCategory
} from '@leadforge/schema';

// Mocks
vi.mock('../../db/models/campaign.model.js', () => ({
  CampaignModel: {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn()
  }
}));

vi.mock('../../db/models/email-delivery.model.js', () => ({
  EmailDeliveryModel: {
    find: vi.fn()
  }
}));

vi.mock('../../db/models/index.js', () => ({
  JobModel: {
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 })
  },
  SequenceExecutionModel: {
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 })
  }
}));

describe('Campaign Outbound Rejection Circuit Breaker Suite (Issue #35)', () => {
  const workspaceId = 'ws_circuit_breaker_test';
  const campaignId = 'camp_safety_test_1';
  let breakerService: CampaignCircuitBreakerService;

  beforeEach(() => {
    vi.clearAllMocks();
    breakerService = new CampaignCircuitBreakerService(workspaceId);
  });

  describe('Category Filtering (isCircuitBreakerRejectionCategory)', () => {
    it('treats POLICY, INVALID_RECIPIENT, and RATE_LIMIT as circuit breaker rejections', () => {
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.POLICY)).toBe(true);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.INVALID_RECIPIENT)).toBe(true);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.RATE_LIMIT)).toBe(true);
      expect(isCircuitBreakerRejectionCategory('policy')).toBe(true);
      expect(isCircuitBreakerRejectionCategory('invalid_recipient')).toBe(true);
      expect(isCircuitBreakerRejectionCategory('rate_limit')).toBe(true);
    });

    it('excludes NETWORK, AUTH, INTERNAL, and AMBIGUOUS from breaker rejections', () => {
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.NETWORK)).toBe(false);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.AUTH)).toBe(false);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.INTERNAL)).toBe(false);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.AMBIGUOUS)).toBe(false);
      expect(isCircuitBreakerRejectionCategory(null)).toBe(false);
      expect(isCircuitBreakerRejectionCategory(undefined)).toBe(false);
    });
  });

  describe('Threshold Not Reached (Criterion A)', () => {
    it('does not trip breaker when rejection count is below consecutive and window thresholds', async () => {
      // Campaign is ACTIVE
      (CampaignModel.findOne as any).mockResolvedValue({
        _id: campaignId,
        workspaceId,
        status: CampaignStatus.ACTIVE,
        settings: {}
      });

      // Recent deliveries: 2 rejections, then 1 sent (below consecutive threshold of 3)
      const mockDeliveries = [
        {
          status: 'FAILED',
          failureCategory: EmailFailureCategory.POLICY,
          createdAt: new Date()
        },
        {
          status: 'FAILED',
          failureCategory: EmailFailureCategory.INVALID_RECIPIENT,
          createdAt: new Date(Date.now() - 10000)
        },
        {
          status: 'SENT',
          createdAt: new Date(Date.now() - 20000)
        }
      ];

      (EmailDeliveryModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(mockDeliveries)
        })
      });

      const result = await breakerService.checkAndTripBreaker(workspaceId, campaignId, {
        id: 'del_1',
        failureCategory: EmailFailureCategory.POLICY,
        failureCode: '554_SPAM',
        technicalMessage: 'Spamhaus block'
      });

      expect(result.tripped).toBe(false);
      expect(result.evaluation?.shouldTrip).toBe(false);
      expect(result.evaluation?.consecutiveRejections).toBe(2);
      expect(result.evaluation?.windowRejections).toBe(2);
      expect(CampaignModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Consecutive Rejection Threshold (Criterion B)', () => {
    it('atomically trips breaker when consecutive rejections reach 3', async () => {
      (CampaignModel.findOne as any).mockResolvedValue({
        _id: campaignId,
        workspaceId,
        status: CampaignStatus.ACTIVE,
        settings: {}
      });

      // 3 consecutive rejections
      const mockDeliveries = [
        {
          status: 'FAILED',
          failureCategory: EmailFailureCategory.POLICY,
          createdAt: new Date()
        },
        {
          status: 'FAILED',
          failureCategory: EmailFailureCategory.POLICY,
          createdAt: new Date(Date.now() - 5000)
        },
        {
          status: 'FAILED',
          failureCategory: EmailFailureCategory.INVALID_RECIPIENT,
          createdAt: new Date(Date.now() - 10000)
        }
      ];

      (EmailDeliveryModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(mockDeliveries)
        })
      });

      const updatedCampaign = {
        _id: campaignId,
        workspaceId,
        status: CampaignStatus.PAUSED,
        settings: {
          pauseReason: CampaignPauseReason.OUTBOUND_REJECTION_CIRCUIT_BREAKER,
          circuitBreakerTrippedAt: new Date().toISOString()
        }
      };
      (CampaignModel.findOneAndUpdate as any).mockResolvedValue(updatedCampaign);

      const result = await breakerService.checkAndTripBreaker(workspaceId, campaignId, {
        id: 'del_3',
        failureCategory: EmailFailureCategory.POLICY,
        failureCode: '554_SPAM',
        technicalMessage: 'Client host blocked using Spamhaus'
      });

      expect(result.tripped).toBe(true);
      expect(result.reason).toContain('Consecutive provider rejections');
      expect(result.evaluation?.consecutiveRejections).toBe(3);

      // Verify atomic update was called with status: ACTIVE condition
      expect(CampaignModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: campaignId,
          workspaceId,
          status: CampaignStatus.ACTIVE
        },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: CampaignStatus.PAUSED,
            'settings.pauseReason': CampaignPauseReason.OUTBOUND_REJECTION_CIRCUIT_BREAKER,
            'settings.circuitBreakerTrigger': expect.objectContaining({
              reason: expect.stringContaining('Consecutive provider rejections'),
              consecutiveRejections: 3,
              lastDeliveryId: 'del_3',
              lastFailureCategory: EmailFailureCategory.POLICY,
              lastFailureCode: '554_SPAM'
            })
          })
        }),
        { new: true }
      );

      // Verify jobs cancelled and sequences paused
      expect(JobModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          'payload.campaignId': campaignId,
          status: { $in: ['queued', 'starting', 'running', 'retrying'] }
        }),
        { $set: { status: 'cancelled' } }
      );

      expect(SequenceExecutionModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          campaignId
        }),
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'PAUSED' })
        })
      );
    });
  });

  describe('Window Rejection Threshold (Criterion C)', () => {
    it('trips breaker when 5 rejections occur in rolling 15-minute window even if interleaved with sent emails', async () => {
      (CampaignModel.findOne as any).mockResolvedValue({
        _id: campaignId,
        workspaceId,
        status: CampaignStatus.ACTIVE,
        settings: {}
      });

      // 5 rejections interleaved with successful sends: consecutive is only 1, but window is 5
      const mockDeliveries = [
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: new Date() },
        { status: 'SENT', createdAt: new Date(Date.now() - 60000) },
        { status: 'FAILED', failureCategory: EmailFailureCategory.INVALID_RECIPIENT, createdAt: new Date(Date.now() - 120000) },
        { status: 'SENT', createdAt: new Date(Date.now() - 180000) },
        { status: 'FAILED', failureCategory: EmailFailureCategory.RATE_LIMIT, createdAt: new Date(Date.now() - 240000) },
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: new Date(Date.now() - 300000) },
        { status: 'FAILED', failureCategory: EmailFailureCategory.INVALID_RECIPIENT, createdAt: new Date(Date.now() - 360000) }
      ];

      (EmailDeliveryModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(mockDeliveries)
        })
      });

      (CampaignModel.findOneAndUpdate as any).mockResolvedValue({
        _id: campaignId,
        status: CampaignStatus.PAUSED
      });

      const result = await breakerService.checkAndTripBreaker(workspaceId, campaignId);

      expect(result.tripped).toBe(true);
      expect(result.reason).toContain('Window provider rejections');
      expect(result.evaluation?.windowRejections).toBe(5);
      expect(result.evaluation?.consecutiveRejections).toBe(1);
    });
  });

  describe('Continued Rejection After Pause (Criterion D)', () => {
    it('does not re-trip or execute updates if campaign is already PAUSED', async () => {
      // Campaign is already PAUSED
      (CampaignModel.findOne as any).mockResolvedValue({
        _id: campaignId,
        workspaceId,
        status: CampaignStatus.PAUSED,
        settings: {
          pauseReason: CampaignPauseReason.OUTBOUND_REJECTION_CIRCUIT_BREAKER
        }
      });

      const result = await breakerService.checkAndTripBreaker(workspaceId, campaignId, {
        id: 'late_rejection',
        failureCategory: EmailFailureCategory.POLICY
      });

      expect(result.tripped).toBe(false);
      expect(EmailDeliveryModel.find).not.toHaveBeenCalled();
      expect(CampaignModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Concurrency & Race Safety (Criterion E)', () => {
    it('gracefully handles concurrent workers: only the first transition succeeds', async () => {
      // Both workers find campaign ACTIVE in initial check
      (CampaignModel.findOne as any).mockResolvedValue({
        _id: campaignId,
        workspaceId,
        status: CampaignStatus.ACTIVE,
        settings: {}
      });

      const mockDeliveries = [
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: new Date() },
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: new Date() },
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: new Date() }
      ];

      (EmailDeliveryModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(mockDeliveries)
        })
      });

      // Second worker's atomic findOneAndUpdate returns null because status is no longer ACTIVE
      (CampaignModel.findOneAndUpdate as any).mockResolvedValue(null);

      const result = await breakerService.checkAndTripBreaker(workspaceId, campaignId);

      expect(result.tripped).toBe(false);
      expect(result.reason).toContain('already paused');
      // Should not attempt to cancel jobs or pause executions if transition did not win
      expect(JobModel.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('Preservation of User and Terminal States (Criteria F & G)', () => {
    it('preserves USER_REQUESTED pause and never modifies it', async () => {
      (CampaignModel.findOne as any).mockResolvedValue({
        _id: campaignId,
        workspaceId,
        status: CampaignStatus.PAUSED,
        settings: {
          pauseReason: CampaignPauseReason.USER_REQUESTED
        }
      });

      const result = await breakerService.checkAndTripBreaker(workspaceId, campaignId);

      expect(result.tripped).toBe(false);
      expect(CampaignModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('preserves STOPPED terminal state and never transitions to PAUSED', async () => {
      (CampaignModel.findOne as any).mockResolvedValue({
        _id: campaignId,
        workspaceId,
        status: CampaignStatus.STOPPED,
        settings: {}
      });

      const result = await breakerService.checkAndTripBreaker(workspaceId, campaignId);

      expect(result.tripped).toBe(false);
      expect(CampaignModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('preserves COMPLETED and FAILED terminal states', async () => {
      for (const terminalStatus of [CampaignStatus.COMPLETED, CampaignStatus.FAILED]) {
        (CampaignModel.findOne as any).mockResolvedValue({
          _id: campaignId,
          workspaceId,
          status: terminalStatus,
          settings: {}
        });

        const result = await breakerService.checkAndTripBreaker(workspaceId, campaignId);
        expect(result.tripped).toBe(false);
      }
      expect(CampaignModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Resumption Behavior & Window Boundary (Criterion I)', () => {
    it('restricts rolling window to sends after settings.resumedAt', async () => {
      const resumedAt = new Date(Date.now() - 5 * 60 * 1000); // Resumed 5 minutes ago

      (CampaignModel.findOne as any).mockResolvedValue({
        _id: campaignId,
        workspaceId,
        status: CampaignStatus.ACTIVE,
        settings: {
          resumedAt: resumedAt.toISOString()
        }
      });

      (EmailDeliveryModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([])
        })
      });

      await breakerService.checkAndTripBreaker(workspaceId, campaignId);

      // Verify the query to EmailDeliveryModel used createdAt >= resumedAt
      expect(EmailDeliveryModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          campaignId,
          direction: 'OUTBOUND',
          status: { $in: ['SENT', 'FAILED'] },
          createdAt: { $gte: resumedAt }
        })
      );
    });
  });

  describe('Non-Rejection Failure Isolation (Criterion H)', () => {
    it('does not count NETWORK or AUTH failures toward breaker consecutive or window metrics', async () => {
      (CampaignModel.findOne as any).mockResolvedValue({
        _id: campaignId,
        workspaceId,
        status: CampaignStatus.ACTIVE,
        settings: {}
      });

      // Deliveries have 3 FAILED statuses, but they are NETWORK and AUTH, NOT provider rejections
      const mockDeliveries = [
        { status: 'FAILED', failureCategory: EmailFailureCategory.NETWORK, createdAt: new Date() },
        { status: 'FAILED', failureCategory: EmailFailureCategory.AUTH, createdAt: new Date(Date.now() - 5000) },
        { status: 'FAILED', failureCategory: EmailFailureCategory.INTERNAL, createdAt: new Date(Date.now() - 10000) }
      ];

      (EmailDeliveryModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(mockDeliveries)
        })
      });

      const result = await breakerService.checkAndTripBreaker(workspaceId, campaignId);

      // None of these are rejection categories -> 0 consecutive, 0 window
      expect(result.tripped).toBe(false);
      expect(result.evaluation?.consecutiveRejections).toBe(0);
      expect(result.evaluation?.windowRejections).toBe(0);
      expect(CampaignModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
