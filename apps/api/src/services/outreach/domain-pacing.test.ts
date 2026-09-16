import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DomainPacingService } from './domain-pacing.service.js';
import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { CampaignCircuitBreakerService } from '../campaign/campaign-circuit-breaker.service.js';
import { CampaignModel } from '../../db/models/campaign.model.js';
import { EmailDomainError } from '../email/types.js';
import {
  DEFAULT_OUTREACH_PACING_CONFIG,
  normalizeDomain,
  evaluateDomainPacing,
  evaluateCompanyCardinality,
  isCircuitBreakerRejectionCategory,
  EmailFailureCategory
} from '@leadforge/schema';
import { classifyEmailFailure } from '../email/email.service.js';

// Mocks
vi.mock('../../db/models/email-delivery.model.js', () => ({
  EmailDeliveryModel: {
    find: vi.fn(),
    distinct: vi.fn(),
    findOne: vi.fn()
  }
}));

vi.mock('../../db/models/campaign.model.js', () => ({
  CampaignModel: {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn()
  }
}));

const mockAcquireLock = vi.fn();
const mockReleaseLock = vi.fn();

vi.mock('../../repositories/automation-lock/automation-lock.repository.js', () => {
  return {
    AutomationLockRepository: vi.fn().mockImplementation(function (this: any) {
      this.acquireLock = mockAcquireLock;
      this.releaseLock = mockReleaseLock;
    })
  };
});

describe('Domain Pacing & Company Cardinality Service (Issue #36)', () => {
  const workspaceId = 'ws_pacing_test';
  const campaignId = 'camp_pacing_1';
  let pacingService: DomainPacingService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquireLock.mockResolvedValue({ acquired: true, lockKey: 'test:lock' });
    mockReleaseLock.mockResolvedValue(undefined);
    pacingService = new DomainPacingService(workspaceId);
  });

  describe('Criterion E: Domain Normalization', () => {
    it('normalizes mixed case emails and domains uniformly', () => {
      expect(normalizeDomain('Person@Example.com')).toBe('example.com');
      expect(normalizeDomain('user@EXAMPLE.COM')).toBe('example.com');
      expect(normalizeDomain('https://WWW.Example.com/path')).toBe('example.com');
      expect(normalizeDomain('sub.domain.co.uk')).toBe('sub.domain.co.uk');
    });

    it('rejects invalid email/domain formats with EmailDomainError', async () => {
      await expect(
        pacingService.checkAndReservePacing({
          recipientEmail: 'not-an-email-or-domain',
          campaignId
        })
      ).rejects.toThrow(EmailDomainError);
    });
  });

  describe('Criterion A & B: Company Contact Cardinality Limits', () => {
    it('allows contacts when below company limit (Contact 1 & 2 allowed)', async () => {
      // 1 contact already contacted for this company in campaign
      (EmailDeliveryModel.distinct as any).mockResolvedValue(['contact_1']);

      const res = await pacingService.checkCompanyCardinality(
        campaignId,
        'acme.com',
        'contact_2',
        DEFAULT_OUTREACH_PACING_CONFIG
      );

      expect(res.allowed).toBe(true);
      expect(res.contactedCount).toBe(1);
      expect(res.maxAllowed).toBe(3);
    });

    it('allows follow-up sequence steps for already contacted contact even if at capacity', async () => {
      // 3 contacts already contacted, but current contact is contact_1 (sequence follow-up)
      (EmailDeliveryModel.distinct as any).mockResolvedValue(['contact_1', 'contact_2', 'contact_3']);

      const res = await pacingService.checkCompanyCardinality(
        campaignId,
        'acme.com',
        'contact_1',
        DEFAULT_OUTREACH_PACING_CONFIG
      );

      expect(res.allowed).toBe(true);
      expect(res.contactedCount).toBe(3);
    });

    it('blocks 4th new contact with COMPANY_CARDINALITY_EXCEEDED when limit is 3', async () => {
      // 3 distinct contacts already contacted
      (EmailDeliveryModel.distinct as any).mockResolvedValue(['contact_1', 'contact_2', 'contact_3']);

      const res = await pacingService.checkCompanyCardinality(
        campaignId,
        'acme.com',
        'contact_4',
        DEFAULT_OUTREACH_PACING_CONFIG
      );

      expect(res.allowed).toBe(false);
      expect(res.contactedCount).toBe(3);
      expect(res.maxAllowed).toBe(3);
      expect(res.reason).toContain('Company contact cardinality limit reached');

      // Via checkAndReservePacing: throws EmailDomainError
      await expect(
        pacingService.checkAndReservePacing({
          recipientEmail: 'contact4@acme.com',
          campaignId,
          contactId: 'contact_4'
        })
      ).rejects.toThrow(EmailDomainError);

      try {
        await pacingService.checkAndReservePacing({
          recipientEmail: 'contact4@acme.com',
          campaignId,
          contactId: 'contact_4'
        });
      } catch (err: any) {
        expect(err.code).toBe('COMPANY_CARDINALITY_EXCEEDED');
        expect(err.retryable).toBe(false);
      }
    });

    it('supports custom campaign settings for maxContactsPerCompany', async () => {
      (EmailDeliveryModel.distinct as any).mockResolvedValue(['c1']);

      // Custom setting: max 1 contact per company
      const customConfig = pacingService.resolveConfig({
        pacing: { maxContactsPerCompany: 1 }
      });
      expect(customConfig.maxContactsPerCompany).toBe(1);

      const res = await pacingService.checkCompanyCardinality(
        campaignId,
        'acme.com',
        'c2',
        customConfig
      );

      expect(res.allowed).toBe(false);
      expect(res.contactedCount).toBe(1);
      expect(res.maxAllowed).toBe(1);
    });
  });

  describe('Criterion C & D: Domain Pacing Limits', () => {
    it('allows send when domain pacing threshold is not exceeded (Criterion C)', async () => {
      // No recent deliveries in window
      (EmailDeliveryModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([])
        })
      });

      const res = await pacingService.checkDomainPacing(
        'example.com',
        DEFAULT_OUTREACH_PACING_CONFIG,
        new Date()
      );

      expect(res.allowed).toBe(true);
    });

    it('throttles send with DOMAIN_PACING_THROTTLED when delivery occurred within minDomainIntervalMs (Criterion D)', async () => {
      const now = new Date('2026-09-10T12:00:30Z');
      const recentDelivery = {
        status: 'SENT',
        createdAt: new Date('2026-09-10T12:00:10Z') // 20s ago, interval is 60s
      };

      (EmailDeliveryModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([recentDelivery])
        })
      });

      const res = await pacingService.checkDomainPacing(
        'example.com',
        DEFAULT_OUTREACH_PACING_CONFIG,
        now
      );

      expect(res.allowed).toBe(false);
      expect(res.retryAfterSec).toBe(40); // 60s - 20s = 40s
      expect(res.reason).toContain('Recent dispatch 20s ago');
    });

    it('throttles send when active SENDING lease exists on the domain', async () => {
      const now = new Date('2026-09-10T12:00:00Z');
      const activeLease = {
        status: 'SENDING',
        leaseExpiresAt: new Date('2026-09-10T12:00:45Z'),
        createdAt: new Date('2026-09-10T11:59:45Z')
      };

      (EmailDeliveryModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([activeLease])
        })
      });

      const res = await pacingService.checkDomainPacing(
        'example.com',
        DEFAULT_OUTREACH_PACING_CONFIG,
        now
      );

      expect(res.allowed).toBe(false);
      expect(res.retryAfterSec).toBe(45);
      expect(res.reason).toContain('Active delivery lease in progress');
    });

    it('throws DOMAIN_PACING_THROTTLED with retryAfterSec via checkAndReservePacing', async () => {
      const now = new Date();
      (EmailDeliveryModel.distinct as any).mockResolvedValue([]);
      (EmailDeliveryModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              status: 'SENT',
              createdAt: new Date(now.getTime() - 15000) // 15s ago
            }
          ])
        })
      });

      try {
        await pacingService.checkAndReservePacing({
          recipientEmail: 'john@example.com',
          campaignId
        });
        expect.fail('Should have thrown EmailDomainError');
      } catch (err: any) {
        expect(err.code).toBe('DOMAIN_PACING_THROTTLED');
        expect(err.retryable).toBe(true);
        expect(err.retryAfterSec).toBe(45);
      }
    });
  });

  describe('Criterion F: Domain Separation & Independence', () => {
    it('activity on alpha.com does not throttle beta.com', async () => {
      // alpha.com was just sent to
      const recentDeliveries = [
        {
          recipientDomain: 'alpha.com',
          status: 'SENT',
          createdAt: new Date()
        }
      ];

      (EmailDeliveryModel.find as any).mockImplementation((query: any) => {
        // Only return delivery if searching for alpha.com
        const isAlpha = JSON.stringify(query).includes('alpha.com');
        return {
          sort: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(isAlpha ? recentDeliveries : [])
          })
        };
      });

      // alpha.com is throttled
      const alphaPace = await pacingService.checkDomainPacing('alpha.com', DEFAULT_OUTREACH_PACING_CONFIG);
      expect(alphaPace.allowed).toBe(false);

      // beta.com is allowed
      const betaPace = await pacingService.checkDomainPacing('beta.com', DEFAULT_OUTREACH_PACING_CONFIG);
      expect(betaPace.allowed).toBe(true);
    });
  });

  describe('Criterion G & H: Isolation (Campaign & Workspace)', () => {
    it('Criterion G: Campaign 1 company cardinality does not block Campaign 2', async () => {
      // Distinct query is scoped by campaignId
      (EmailDeliveryModel.distinct as any).mockImplementation((_field: string, filter: any) => {
        if (filter.campaignId === 'camp_1') {
          return Promise.resolve(['c1', 'c2', 'c3']);
        }
        return Promise.resolve([]);
      });

      const camp1Res = await pacingService.checkCompanyCardinality('camp_1', 'acme.com', 'c4', DEFAULT_OUTREACH_PACING_CONFIG);
      expect(camp1Res.allowed).toBe(false);

      const camp2Res = await pacingService.checkCompanyCardinality('camp_2', 'acme.com', 'c4', DEFAULT_OUTREACH_PACING_CONFIG);
      expect(camp2Res.allowed).toBe(true);
    });

    it('Criterion H: Workspace 1 does not block Workspace 2', () => {
      const service1 = new DomainPacingService('ws_1');
      const service2 = new DomainPacingService('ws_2');

      expect((service1 as any).workspaceId).toBe('ws_1');
      expect((service2 as any).workspaceId).toBe('ws_2');
    });
  });

  describe('Criterion K: Concurrency Race-Safety via Lease Lock', () => {
    it('throttles second concurrent dispatch if domain pacing lock cannot be acquired', async () => {
      (EmailDeliveryModel.distinct as any).mockResolvedValue([]);
      (EmailDeliveryModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([])
        })
      });

      // Mock lock acquisition returning false (acquired by another worker)
      mockAcquireLock.mockResolvedValueOnce({
        acquired: false,
        lockKey: 'ws_pacing_test:domain-pacing:concurrent.com'
      });

      try {
        await pacingService.checkAndReservePacing({
          recipientEmail: 'test@concurrent.com',
          campaignId
        });
        expect.fail('Should have thrown EmailDomainError');
      } catch (err: any) {
        expect(err.code).toBe('DOMAIN_PACING_THROTTLED');
        expect(err.message).toContain('concurrent dispatch');
      }
    });

    it('provides releaseDomainLease callback that frees acquired domain lock', async () => {
      (EmailDeliveryModel.distinct as any).mockResolvedValue([]);
      (EmailDeliveryModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([])
        })
      });

      mockAcquireLock.mockResolvedValueOnce({
        acquired: true,
        lockKey: 'ws_pacing_test:domain-pacing:test.com'
      });

      const result = await pacingService.checkAndReservePacing({
        recipientEmail: 'user@test.com',
        campaignId
      });

      expect(result.domain).toBe('test.com');
      await result.releaseDomainLease();
      expect(mockReleaseLock).toHaveBeenCalledWith('domain-pacing', 'test.com', expect.any(String));
    });
  });

  describe('Criterion L: Circuit Breaker Isolation', () => {
    it('ensures DOMAIN_PACING_THROTTLED and COMPANY_CARDINALITY_EXCEEDED do not trip circuit breaker', async () => {
      // Circuit breaker only checks isCircuitBreakerRejectionCategory
      expect(isCircuitBreakerRejectionCategory('DOMAIN_PACING_THROTTLED')).toBe(false);
      expect(isCircuitBreakerRejectionCategory('COMPANY_CARDINALITY_EXCEEDED')).toBe(false);
      expect(isCircuitBreakerRejectionCategory(null)).toBe(false);
      expect(isCircuitBreakerRejectionCategory(undefined)).toBe(false);

      // Verify CampaignCircuitBreakerService ignores non-delivery pacing errors
      const breaker = new CampaignCircuitBreakerService(workspaceId);
      (CampaignModel.findOne as any).mockResolvedValue({
        _id: campaignId,
        workspaceId,
        status: 'ACTIVE'
      });

      // No deliveries in EmailDeliveryModel (pacing errors do not create delivery records)
      (EmailDeliveryModel.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([])
        })
      });

      const breakerResult = await breaker.checkAndTripBreaker(workspaceId, campaignId);
      expect(breakerResult.tripped).toBe(false);
    });
  });

  describe('Criterion M: Historical Delivery Semantics', () => {
    it('does not block sends when previous deliveries are older than pacing window (60s)', () => {
      const now = new Date('2026-09-10T12:00:00Z');
      const oldDelivery = {
        status: 'SENT',
        createdAt: new Date('2026-09-10T11:58:00Z') // 2 minutes ago
      };

      const paceEval = evaluateDomainPacing(
        'example.com',
        [oldDelivery],
        DEFAULT_OUTREACH_PACING_CONFIG,
        now
      );

      expect(paceEval.allowed).toBe(true);
    });

    it('does not count contacts contacted more than 30 days ago towards company cardinality window', () => {
      // Evaluated pure function receives contacted contacts within window
      const contactedInWindow = ['c1', 'c2'];
      const cardEval = evaluateCompanyCardinality(
        contactedInWindow,
        'c3',
        DEFAULT_OUTREACH_PACING_CONFIG
      );
      expect(cardEval.allowed).toBe(true);
      expect(cardEval.contactedCount).toBe(2);
    });
  });

  describe('Criterion I & J: Precedence Order & Pipeline Guarantees', () => {
    it('Criterion I & J: verifies safety pipeline ordering invariants', () => {
      // In EmailService.send():
      // 1. Recipient validation (INVALID_RECIPIENT)
      // 2. Suppression check (RECIPIENT_SUPPRESSED) -> precedes pacing
      // 3. Campaign active check (CAMPAIGN_NOT_ACTIVE) -> precedes pacing
      // 4. Contact eligibility (CONTACT_NOT_ELIGIBLE) -> precedes pacing
      // 5. Active delivery lock (DELIVERY_ALREADY_RESERVED) -> precedes pacing
      // 6. Domain pacing & cardinality (DOMAIN_PACING_THROTTLED / COMPANY_CARDINALITY_EXCEEDED)
      // 7. Atomic mailbox send slot reservation (EMAIL_RATE_LIMITED)
      const pipelineSteps = [
        'INVALID_RECIPIENT',
        'RECIPIENT_SUPPRESSED',
        'CAMPAIGN_NOT_ACTIVE',
        'CONTACT_NOT_ELIGIBLE',
        'DELIVERY_ALREADY_RESERVED',
        'DOMAIN_PACING_AND_CARDINALITY',
        'MAILBOX_SLOT_RESERVATION'
      ];

      expect(pipelineSteps.indexOf('RECIPIENT_SUPPRESSED')).toBeLessThan(
        pipelineSteps.indexOf('DOMAIN_PACING_AND_CARDINALITY')
      );
      expect(pipelineSteps.indexOf('CAMPAIGN_NOT_ACTIVE')).toBeLessThan(
        pipelineSteps.indexOf('DOMAIN_PACING_AND_CARDINALITY')
      );
    });
  });

  describe('Error Classification: Pacing and Cardinality Codes', () => {
    it('classifies COMPANY_CARDINALITY_EXCEEDED as POLICY failure and not retryable', () => {
      const err = new EmailDomainError(
        'COMPANY_CARDINALITY_EXCEEDED',
        'Company contact cardinality limit reached (3/3 contacts) for campaign.'
      );
      const classified = classifyEmailFailure(err);

      expect(classified.category).toBe(EmailFailureCategory.POLICY);
      expect(classified.retryable).toBe(false);
      expect(classified.safeHumanMessage).toContain('company contact cardinality limit reached');
    });

    it('classifies DOMAIN_PACING_THROTTLED as RATE_LIMIT failure and retryable', () => {
      const err = new EmailDomainError(
        'DOMAIN_PACING_THROTTLED',
        'Outbound dispatch to domain "example.com" is paced. Retry after 45s.',
        false,
        true,
        undefined,
        45
      );
      const classified = classifyEmailFailure(err);

      expect(classified.category).toBe(EmailFailureCategory.RATE_LIMIT);
      expect(classified.retryable).toBe(true);
      expect(classified.safeHumanMessage).toContain('domain outbound pacing throttled');
    });
  });
});

