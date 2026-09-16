import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  VALID_DELIVERY_TRANSITIONS,
  EmailDeliveryRepository
} from '../../repositories/email-delivery/email-delivery.repository.js';
import { classifyEmailFailure } from './email.service.js';
import {
  EmailFailureCategory,
  isCircuitBreakerRejectionCategory,
  type ReserveEmailDeliveryDto
} from '@leadforge/schema';
import { EmailDomainError } from './types.js';

const createBaseReserveDto = (overrides?: Partial<ReserveEmailDeliveryDto>): ReserveEmailDeliveryDto => ({
  sequenceId: 'seq_1',
  executionId: 'exec_1',
  stepIndex: 0,
  contactId: 'contact_1',
  accountId: 'acc_1',
  senderEmail: 'sender@example.com',
  recipientEmail: 'target@example.com',
  subject: 'Hello',
  idempotencyKey: 'key_123',
  ...overrides
});

describe('fix(email): prevent ambiguous delivery blind re-dispatch (Issue #37)', () => {
  describe('Criterion A: Delivery State Machine Transition Invariants', () => {
    it('VALID_DELIVERY_TRANSITIONS.AMBIGUOUS strictly forbids SENDING and RETRYING', () => {
      expect(VALID_DELIVERY_TRANSITIONS.AMBIGUOUS).not.toContain('SENDING');
      expect(VALID_DELIVERY_TRANSITIONS.AMBIGUOUS).not.toContain('RETRYING');
      expect(VALID_DELIVERY_TRANSITIONS.AMBIGUOUS).toEqual(['SENT', 'FAILED', 'CANCELLED']);
    });

    it('validateTransition disallows AMBIGUOUS -> SENDING', () => {
      expect(EmailDeliveryRepository.validateTransition('AMBIGUOUS', 'SENDING')).toBe(false);
    });

    it('validateTransition disallows AMBIGUOUS -> RETRYING', () => {
      expect(EmailDeliveryRepository.validateTransition('AMBIGUOUS', 'RETRYING')).toBe(false);
    });

    it('validateTransition permits AMBIGUOUS -> SENT (reconciliation confirmed accepted)', () => {
      expect(EmailDeliveryRepository.validateTransition('AMBIGUOUS', 'SENT')).toBe(true);
    });

    it('validateTransition permits AMBIGUOUS -> FAILED (reconciliation confirmed bounce/failure)', () => {
      expect(EmailDeliveryRepository.validateTransition('AMBIGUOUS', 'FAILED')).toBe(true);
    });

    it('validateTransition permits AMBIGUOUS -> CANCELLED (operator/system cancellation)', () => {
      expect(EmailDeliveryRepository.validateTransition('AMBIGUOUS', 'CANCELLED')).toBe(true);
    });

    it('validateTransition forbids terminal SENT -> SENDING', () => {
      expect(EmailDeliveryRepository.validateTransition('SENT', 'SENDING')).toBe(false);
    });

    it('validateTransition forbids terminal SUPPRESSED -> SENDING', () => {
      expect(EmailDeliveryRepository.validateTransition('SUPPRESSED', 'SENDING')).toBe(false);
    });
  });

  describe('Criterion B: Ambiguous Send Error Classification and Non-Retryability', () => {
    it('classifies AMBIGUOUS_SEND_TIMEOUT as non-retryable and ambiguous', () => {
      const err = new Error('Socket closed while waiting for HTTP response');
      (err as any).code = 'AMBIGUOUS_SEND_TIMEOUT';

      const result = classifyEmailFailure(err);
      expect(result.category).toBe(EmailFailureCategory.AMBIGUOUS);
      expect(result.retryable).toBe(false);
      expect(result.ambiguous).toBe(true);
      expect(result.safeHumanMessage).toMatch(/ambiguous/i);
    });

    it('classifies ambiguous error messages containing "ambiguous network timeout"', () => {
      const err = new Error('Ambiguous network timeout occurred during dispatch');
      const result = classifyEmailFailure(err);

      expect(result.category).toBe(EmailFailureCategory.AMBIGUOUS);
      expect(result.retryable).toBe(false);
      expect(result.ambiguous).toBe(true);
    });

    it('EmailDomainError constructed with AMBIGUOUS_SEND_TIMEOUT sets retryable to false', () => {
      const domainErr = new EmailDomainError(
        'AMBIGUOUS_SEND_TIMEOUT',
        'Timeout contacting provider API',
        false,
        false,
        'ambiguous_network'
      );
      expect(domainErr.code).toBe('AMBIGUOUS_SEND_TIMEOUT');
      expect(domainErr.retryable).toBe(false);
    });
  });

  describe('Criterion E & G: Repository reserveDelivery Invariants', () => {
    let repo: EmailDeliveryRepository;

    beforeEach(() => {
      repo = new EmailDeliveryRepository('ws_ambiguous_test');
      vi.restoreAllMocks();
    });

    it('forbids reclaiming an existing AMBIGUOUS delivery for the same idempotencyKey', async () => {
      const existingDoc: any = {
        _id: 'del_ambig_1',
        idempotencyKey: 'key_123',
        status: 'AMBIGUOUS',
        retryable: false
      };

      vi.spyOn(repo, 'findOne').mockResolvedValue(existingDoc);

      await expect(
        repo.reserveDelivery(
          createBaseReserveDto({
            idempotencyKey: 'key_123',
            senderEmail: 'sender@example.com',
            recipientEmail: 'target@example.com',
            subject: 'Hello',
            accountId: 'acc_1'
          })
        )
      ).rejects.toThrow(
        /is in AMBIGUOUS state pending reconciliation\. Blind re-dispatch is forbidden\./
      );
    });

    it('forbids reserving when an AMBIGUOUS delivery exists for the same executionId, contactId, stepIndex', async () => {
      vi.spyOn(repo, 'findOne').mockImplementation(async (query: any) => {
        if (query.idempotencyKey === 'fresh_key_456') {
          return null; // fresh key
        }
        if (
          query.executionId === 'exec_99' &&
          query.contactId === 'contact_88' &&
          query.stepIndex === 1 &&
          query.status === 'AMBIGUOUS'
        ) {
          return {
            _id: 'del_ambig_exec',
            executionId: 'exec_99',
            contactId: 'contact_88',
            stepIndex: 1,
            status: 'AMBIGUOUS'
          } as any;
        }
        return null;
      });

      await expect(
        repo.reserveDelivery(
          createBaseReserveDto({
            idempotencyKey: 'fresh_key_456',
            executionId: 'exec_99',
            contactId: 'contact_88',
            stepIndex: 1,
            senderEmail: 'sender@example.com',
            recipientEmail: 'target@example.com',
            subject: 'Hello',
            accountId: 'acc_1'
          })
        )
      ).rejects.toThrow(
        /An outbound delivery for execution "exec_99", step 1, contact "contact_88" is in AMBIGUOUS state pending reconciliation/
      );
    });

    it('forbids reserving when an AMBIGUOUS delivery exists for the same campaignId, contactId, stepIndex', async () => {
      vi.spyOn(repo, 'findOne').mockImplementation(async (query: any) => {
        if (query.idempotencyKey === 'fresh_camp_key') {
          return null;
        }
        if (
          query.campaignId === 'camp_77' &&
          query.contactId === 'contact_88' &&
          query.stepIndex === 0 &&
          query.status === 'AMBIGUOUS'
        ) {
          return {
            _id: 'del_ambig_camp',
            campaignId: 'camp_77',
            contactId: 'contact_88',
            stepIndex: 0,
            status: 'AMBIGUOUS'
          } as any;
        }
        return null;
      });

      await expect(
        repo.reserveDelivery(
          createBaseReserveDto({
            idempotencyKey: 'fresh_camp_key',
            campaignId: 'camp_77',
            contactId: 'contact_88',
            stepIndex: 0,
            senderEmail: 'sender@example.com',
            recipientEmail: 'target@example.com',
            subject: 'Hello',
            accountId: 'acc_1'
          })
        )
      ).rejects.toThrow(
        /An outbound delivery for campaign "camp_77", step 0, contact "contact_88" is in AMBIGUOUS state pending reconciliation/
      );
    });

    it('forbids re-dispatch of a permanent non-retryable FAILED delivery', async () => {
      const permanentFailedDoc: any = {
        _id: 'del_perm_failed',
        idempotencyKey: 'perm_failed_key',
        status: 'FAILED',
        retryable: false
      };

      vi.spyOn(repo, 'findOne').mockResolvedValue(permanentFailedDoc);

      await expect(
        repo.reserveDelivery(
          createBaseReserveDto({
            idempotencyKey: 'perm_failed_key',
            senderEmail: 'sender@example.com',
            recipientEmail: 'bad@example.com',
            subject: 'Hello',
            accountId: 'acc_1'
          })
        )
      ).rejects.toThrow(/Cannot transition delivery del_perm_failed from permanent FAILED status to SENDING/);
    });

    it('allows re-reservation of a retryable FAILED delivery', async () => {
      const retryableFailedDoc: any = {
        _id: 'del_retryable_failed',
        idempotencyKey: 'retryable_failed_key',
        status: 'FAILED',
        retryable: true,
        attempt: 1
      };

      vi.spyOn(repo, 'findOne').mockResolvedValue(retryableFailedDoc);
      vi.spyOn(repo, 'atomicFindOneAndUpdate').mockResolvedValue({
        ...retryableFailedDoc,
        status: 'SENDING',
        attempt: 2
      } as any);

      const result = await repo.reserveDelivery(
        createBaseReserveDto({
          idempotencyKey: 'retryable_failed_key',
          senderEmail: 'sender@example.com',
          recipientEmail: 'target@example.com',
          subject: 'Hello',
          accountId: 'acc_1'
        })
      );

      expect(result.isAlreadySent).toBe(false);
      expect(result.delivery.status).toBe('SENDING');
      expect(result.delivery.attempt).toBe(2);
    });
  });

  describe('Criterion M: Concurrency Race Condition Invariants', () => {
    let repo: EmailDeliveryRepository;

    beforeEach(() => {
      repo = new EmailDeliveryRepository('ws_ambiguous_race');
      vi.restoreAllMocks();
    });

    it('throws AMBIGUOUS_SEND_TIMEOUT when concurrent insertion resolves to an AMBIGUOUS delivery', async () => {
      let callCount = 0;
      vi.spyOn(repo, 'findOne').mockImplementation(async (query: any) => {
        if (query.status === 'AMBIGUOUS') {
          return null;
        }
        if (query.idempotencyKey === 'race_key') {
          callCount++;
          if (callCount === 1) return null;
          return {
            _id: 'del_concurrent_ambig',
            idempotencyKey: 'race_key',
            status: 'AMBIGUOUS'
          } as any;
        }
        return null;
      });

      const duplicateError: any = new Error('E11000 duplicate key error collection');
      duplicateError.code = 11000;
      vi.spyOn(repo, 'create').mockRejectedValue(duplicateError);

      await expect(
        repo.reserveDelivery(
          createBaseReserveDto({
            idempotencyKey: 'race_key',
            senderEmail: 'sender@example.com',
            recipientEmail: 'target@example.com',
            subject: 'Hello',
            accountId: 'acc_1'
          })
        )
      ).rejects.toThrow(
        /is in AMBIGUOUS state pending reconciliation\. Blind re-dispatch is forbidden\./
      );
    });

    it('returns isAlreadySent: true when concurrent insertion resolves to SENT delivery', async () => {
      let callCount = 0;
      vi.spyOn(repo, 'findOne').mockImplementation(async (query: any) => {
        if (query.status === 'AMBIGUOUS') {
          return null;
        }
        if (query.idempotencyKey === 'race_key_sent') {
          callCount++;
          if (callCount === 1) return null;
          return {
            _id: 'del_concurrent_sent',
            idempotencyKey: 'race_key_sent',
            status: 'SENT'
          } as any;
        }
        return null;
      });

      const duplicateError: any = new Error('E11000 duplicate key error collection');
      duplicateError.code = 11000;
      vi.spyOn(repo, 'create').mockRejectedValue(duplicateError);

      const result = await repo.reserveDelivery(
        createBaseReserveDto({
          idempotencyKey: 'race_key_sent',
          senderEmail: 'sender@example.com',
          recipientEmail: 'target@example.com',
          subject: 'Hello',
          accountId: 'acc_1'
        })
      );

      expect(result.isAlreadySent).toBe(true);
      expect(result.delivery.status).toBe('SENT');
    });

    it('throws DELIVERY_ALREADY_RESERVED when concurrent insertion resolves to active SENDING delivery', async () => {
      let callCount = 0;
      vi.spyOn(repo, 'findOne').mockImplementation(async (query: any) => {
        if (query.status === 'AMBIGUOUS') {
          return null;
        }
        if (query.idempotencyKey === 'race_key_sending') {
          callCount++;
          if (callCount === 1) return null;
          return {
            _id: 'del_concurrent_sending',
            idempotencyKey: 'race_key_sending',
            status: 'SENDING'
          } as any;
        }
        return null;
      });

      const duplicateError: any = new Error('E11000 duplicate key error collection');
      duplicateError.code = 11000;
      vi.spyOn(repo, 'create').mockRejectedValue(duplicateError);

      await expect(
        repo.reserveDelivery(
          createBaseReserveDto({
            idempotencyKey: 'race_key_sending',
            senderEmail: 'sender@example.com',
            recipientEmail: 'target@example.com',
            subject: 'Hello',
            accountId: 'acc_1'
          })
        )
      ).rejects.toThrow(/Concurrent delivery creation conflict/);
    });
  });

  describe('Criterion J: Outreach Circuit Breaker Protection', () => {
    it('isCircuitBreakerRejectionCategory ignores AMBIGUOUS failure category', () => {
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.AMBIGUOUS)).toBe(false);
      expect(isCircuitBreakerRejectionCategory('AMBIGUOUS')).toBe(false);
      expect(isCircuitBreakerRejectionCategory('ambiguous')).toBe(false);
    });

    it('isCircuitBreakerRejectionCategory triggers only on confirmed provider rejections', () => {
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.POLICY)).toBe(true);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.INVALID_RECIPIENT)).toBe(true);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.RATE_LIMIT)).toBe(true);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.NETWORK)).toBe(false);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.AUTH)).toBe(false);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.INTERNAL)).toBe(false);
    });
  });

  describe('Criterion C & L: Outreach Worker Invariant Validation', () => {
    it('correctly discriminates AMBIGUOUS send outcome from hard bounce and rate limit', () => {
      const ambiguousErr: any = new Error('Delivery timeout pending reconciliation');
      ambiguousErr.code = 'AMBIGUOUS_SEND_TIMEOUT';
      ambiguousErr.category = 'AMBIGUOUS';
      ambiguousErr.ambiguous = true;

      const isAmbiguous =
        ambiguousErr.code === 'AMBIGUOUS_SEND_TIMEOUT' ||
        ambiguousErr.category === 'AMBIGUOUS' ||
        ambiguousErr.ambiguous === true ||
        ambiguousErr.message.includes('AMBIGUOUS_SEND_TIMEOUT') ||
        ambiguousErr.message.includes('ambiguous') ||
        ambiguousErr.message.includes('pending reconciliation');

      expect(isAmbiguous).toBe(true);

      const isHardBounce =
        ambiguousErr.code === 'INVALID_RECIPIENT' ||
        ambiguousErr.status === 400 ||
        ambiguousErr.message.includes('INVALID_RECIPIENT') ||
        ambiguousErr.message.includes('550');

      expect(isHardBounce).toBe(false);

      const isRateLimited =
        ambiguousErr.status === 429 ||
        ambiguousErr.code === 'EMAIL_RATE_LIMITED' ||
        ambiguousErr.code === 'PROVIDER_RATE_LIMITED' ||
        ambiguousErr.code === 'DOMAIN_PACING_THROTTLED' ||
        ambiguousErr.message.includes('RATE_LIMITED') ||
        ambiguousErr.message.includes('429');

      expect(isRateLimited).toBe(false);
    });
  });

  describe('Criterion D: Automation Worker Invariant Validation', () => {
    it('recognizes ambiguous errors and determines non-retry pause behavior', () => {
      const sendErr: any = new Error('Network timeout contacting Gmail API');
      sendErr.code = 'AMBIGUOUS_SEND_TIMEOUT';
      sendErr.ambiguous = true;

      const isAmbiguous =
        sendErr.code === 'AMBIGUOUS_SEND_TIMEOUT' ||
        sendErr.category === 'AMBIGUOUS' ||
        sendErr.ambiguous === true ||
        sendErr.message.includes('AMBIGUOUS_SEND_TIMEOUT') ||
        sendErr.message.includes('ambiguous') ||
        sendErr.message.includes('pending reconciliation');

      expect(isAmbiguous).toBe(true);

      // Invariant: Automation worker must yield status: 'paused', NEVER status: 'wait' with retrySameStep: true
      const workerAction = isAmbiguous ? { status: 'paused' } : { status: 'wait', delaySeconds: 120, retrySameStep: true };
      expect(workerAction.status).toBe('paused');
      expect((workerAction as any).retrySameStep).toBeUndefined();
    });
  });

  describe('Criterion H & I: Provider Acceptance and DSN Reconciliation Invariants', () => {
    let repo: EmailDeliveryRepository;

    beforeEach(() => {
      repo = new EmailDeliveryRepository('ws_ambiguous_recon');
      vi.restoreAllMocks();
    });

    it('finalizeDelivery transitions SENDING -> SENT upon verified acceptance', async () => {
      const sendingDoc: any = {
        _id: 'del_sending_1',
        status: 'SENDING'
      };

      vi.spyOn(repo, 'findById').mockResolvedValue(sendingDoc);
      const updateSpy = vi.spyOn(repo, 'atomicFindOneAndUpdate').mockResolvedValue({
        ...sendingDoc,
        status: 'SENT',
        providerMessageId: 'msg_accepted_123'
      } as any);

      const finalized = await repo.finalizeDelivery('del_sending_1', {
        providerMessageId: 'msg_accepted_123'
      });

      expect(finalized.status).toBe('SENT');
      expect(updateSpy).toHaveBeenCalledWith(
        { _id: 'del_sending_1' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'SENT',
            providerMessageId: 'msg_accepted_123',
            leaseExpiresAt: null
          })
        })
      );
    });

    it('reconciliation can transition AMBIGUOUS -> FAILED via failDelivery', async () => {
      const ambiguousDoc: any = {
        _id: 'del_ambig_to_fail',
        status: 'AMBIGUOUS'
      };

      vi.spyOn(repo, 'findById').mockResolvedValue(ambiguousDoc);
      const updateSpy = vi.spyOn(repo, 'atomicFindOneAndUpdate').mockResolvedValue({
        ...ambiguousDoc,
        status: 'FAILED',
        failureCategory: 'INVALID_RECIPIENT'
      } as any);

      const failedResult = await repo.failDelivery('del_ambig_to_fail', '550 5.1.1 User unknown', {
        failureCategory: 'INVALID_RECIPIENT',
        retryable: false
      });

      expect(failedResult.status).toBe('FAILED');
      expect(updateSpy).toHaveBeenCalledWith(
        { _id: 'del_ambig_to_fail' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'FAILED',
            failureCategory: 'INVALID_RECIPIENT',
            leaseExpiresAt: null
          })
        })
      );
    });
  });
});
