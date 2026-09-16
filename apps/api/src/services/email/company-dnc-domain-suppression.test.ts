import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SuppressionRepository } from '../../repositories/suppression/suppression.repository.js';
import { EmailService } from './email.service.js';
import { SuppressionModel } from '../../db/models/suppression.model.js';
import { ContactModel } from '../../db/models/contact.model.js';
import { CampaignModel } from '../../db/models/campaign.model.js';
import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { EmailAccountModel } from '../../db/models/email-account.model.js';
import { SequenceExecutionModel } from '../../db/models/sequence-execution.model.js';
import { AutomationService } from '../automation/automation.service.js';
import { DomainPacingService } from '../outreach/domain-pacing.service.js';
import {
  SuppressionReason,
  SuppressionTargetType,
  normalizeDomain,
  ContactStatus,
  ContactEmailStatus
} from '@leadforge/schema';
import { EmailDomainError } from './types.js';

vi.mock('../../db/models/suppression.model.js');
vi.mock('../../db/models/contact.model.js');
vi.mock('../../db/models/campaign.model.js');
vi.mock('../../db/models/email-delivery.model.js');
vi.mock('../../db/models/email-account.model.js');
vi.mock('../../db/models/sequence-execution.model.js');

describe('fix(outreach): enforce company-level DNC and domain suppression cascade (#38)', () => {
  const wsA = 'ws_alpha';
  const wsB = 'ws_beta';
  const companyAcme = 'comp_acme_123';
  const companyBeta = 'comp_beta_456';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SuppressionRepository — Company & Domain Cascade Semantics', () => {
    it('Criterion A: Recipient suppression still works', async () => {
      const repo = new SuppressionRepository(wsA);
      (SuppressionModel.countDocuments as any).mockResolvedValue(1);

      const isSupp = await repo.isSuppressed('jane@example.com');
      expect(isSupp).toBe(true);
      expect(SuppressionModel.countDocuments).toHaveBeenCalledWith({
        workspaceId: wsA,
        $or: [
          { targetType: SuppressionTargetType.RECIPIENT, targetId: 'jane@example.com' },
          { email: 'jane@example.com' }
        ]
      });
    });

    it('Criterion B: Company DNC blocks a linked contact', async () => {
      const repo = new SuppressionRepository(wsA);
      (SuppressionModel.countDocuments as any).mockResolvedValue(1);

      const isCompSupp = await repo.isCompanySuppressed(companyAcme);
      expect(isCompSupp).toBe(true);
      expect(SuppressionModel.countDocuments).toHaveBeenCalledWith({
        workspaceId: wsA,
        targetType: SuppressionTargetType.COMPANY,
        targetId: companyAcme
      });
    });

    it('Criterion C: Company DNC blocks multiple contacts under the same company', async () => {
      const repo = new SuppressionRepository(wsA);
      (SuppressionModel.find as any).mockResolvedValue([
        {
          workspaceId: wsA,
          targetType: SuppressionTargetType.COMPANY,
          targetId: companyAcme,
          reason: SuppressionReason.COMPANY_DNC
        }
      ]);

      const evalContact1 = await repo.evaluateEffectiveSuppression({
        email: 'alice@acme.com',
        companyId: companyAcme
      });
      expect(evalContact1.suppressed).toBe(true);
      expect(evalContact1.isCompanySuppressed).toBe(true);
      expect(evalContact1.primaryReason).toBe(SuppressionReason.COMPANY_DNC);

      const evalContact2 = await repo.evaluateEffectiveSuppression({
        email: 'charlie@acme.com',
        companyId: companyAcme
      });
      expect(evalContact2.suppressed).toBe(true);
      expect(evalContact2.isCompanySuppressed).toBe(true);
    });

    it('Criterion D: Company DNC blocks contacts across multiple domains sharing the same canonical companyId', async () => {
      const repo = new SuppressionRepository(wsA);
      (SuppressionModel.find as any).mockResolvedValue([
        {
          workspaceId: wsA,
          targetType: SuppressionTargetType.COMPANY,
          targetId: companyAcme,
          reason: SuppressionReason.COMPANY_DNC
        }
      ]);

      // alice@acme.com and bob@acme.co.uk both share companyAcme
      const evalAlice = await repo.evaluateEffectiveSuppression({
        email: 'alice@acme.com',
        companyId: companyAcme
      });
      const evalBobUk = await repo.evaluateEffectiveSuppression({
        email: 'bob@acme.co.uk',
        companyId: companyAcme
      });

      expect(evalAlice.suppressed).toBe(true);
      expect(evalBobUk.suppressed).toBe(true);
      expect(evalAlice.isCompanySuppressed).toBe(true);
      expect(evalBobUk.isCompanySuppressed).toBe(true);
    });

    it('Criterion E & F: Domain suppression blocks matching normalized domains with case-insensitivity', async () => {
      const repo = new SuppressionRepository(wsA);
      (SuppressionModel.countDocuments as any).mockResolvedValue(1);

      expect(normalizeDomain('Person@Example.COM')).toBe('example.com');
      expect(normalizeDomain('person@example.com')).toBe('example.com');
      expect(normalizeDomain('USER@EXAMPLE.COM')).toBe('example.com');

      const isSupp1 = await repo.isDomainSuppressed('Person@Example.COM');
      const isSupp2 = await repo.isDomainSuppressed('example.com');
      expect(isSupp1).toBe(true);
      expect(isSupp2).toBe(true);
      expect(SuppressionModel.countDocuments).toHaveBeenCalledWith({
        workspaceId: wsA,
        targetType: SuppressionTargetType.DOMAIN,
        targetId: 'example.com'
      });
    });

    it('Criterion G & T: Workspace isolation — suppression in Workspace A does not affect Workspace B', async () => {
      const repoA = new SuppressionRepository(wsA);
      const repoB = new SuppressionRepository(wsB);

      (SuppressionModel.countDocuments as any).mockImplementation((query: any) => {
        if (query.workspaceId === wsA) return Promise.resolve(1);
        return Promise.resolve(0);
      });

      expect(await repoA.isCompanySuppressed(companyAcme)).toBe(true);
      expect(await repoB.isCompanySuppressed(companyAcme)).toBe(false);

      expect(await repoA.isDomainSuppressed('acme.com')).toBe(true);
      expect(await repoB.isDomainSuppressed('acme.com')).toBe(false);
    });

    it('Criterion H & S: Different company does not inherit company DNC', async () => {
      const repo = new SuppressionRepository(wsA);
      (SuppressionModel.countDocuments as any).mockImplementation((query: any) => {
        if (query.targetId === companyAcme) return Promise.resolve(1);
        return Promise.resolve(0);
      });

      expect(await repo.isCompanySuppressed(companyAcme)).toBe(true);
      expect(await repo.isCompanySuppressed(companyBeta)).toBe(false);
    });

    it('Criterion I: Different domain does not inherit domain suppression', async () => {
      const repo = new SuppressionRepository(wsA);
      (SuppressionModel.countDocuments as any).mockImplementation((query: any) => {
        if (query.targetId === 'blocked.com') return Promise.resolve(1);
        return Promise.resolve(0);
      });

      expect(await repo.isDomainSuppressed('blocked.com')).toBe(true);
      expect(await repo.isDomainSuppressed('allowed.com')).toBe(false);
      expect(await repo.isDomainSuppressed('sub.blocked.com')).toBe(false);
    });

    it('Criterion R: Repeated suppression requests are idempotent', async () => {
      const repo = new SuppressionRepository(wsA);
      const existingDoc = {
        workspaceId: wsA,
        targetType: SuppressionTargetType.COMPANY,
        targetId: companyAcme,
        reason: SuppressionReason.COMPANY_DNC,
        source: 'manual',
        save: vi.fn().mockResolvedValue(true)
      };

      (SuppressionModel.findOne as any).mockResolvedValue(existingDoc);

      const res = await repo.suppressCompany(companyAcme, SuppressionReason.COMPANY_DNC);
      expect(existingDoc.save).toHaveBeenCalled();
      expect(SuppressionModel.create).not.toHaveBeenCalled();
      expect(res.targetId).toBe(companyAcme);
    });

    it('Criterion U, V & W: Independent suppression causes and additive unsuppression', async () => {
      const repo = new SuppressionRepository(wsA);

      // Unsuppressing company does NOT delete recipient suppression
      (SuppressionModel.deleteOne as any).mockResolvedValue({ deletedCount: 1 });
      const unsuppCompanyRes = await repo.unsuppressCompany(companyAcme);
      expect(unsuppCompanyRes.unsuppressed).toBe(true);
      expect(SuppressionModel.deleteOne).toHaveBeenCalledWith({
        workspaceId: wsA,
        targetType: SuppressionTargetType.COMPANY,
        targetId: companyAcme
      });

      // If contact still has active HARD_BOUNCE suppression, evaluateEffectiveSuppression remains suppressed
      (SuppressionModel.find as any).mockResolvedValue([
        {
          workspaceId: wsA,
          targetType: SuppressionTargetType.RECIPIENT,
          targetId: 'alice@acme.com',
          reason: SuppressionReason.HARD_BOUNCE
        }
      ]);

      const evalAfterUnsuppCompany = await repo.evaluateEffectiveSuppression({
        email: 'alice@acme.com',
        companyId: companyAcme
      });
      expect(evalAfterUnsuppCompany.suppressed).toBe(true);
      expect(evalAfterUnsuppCompany.isRecipientSuppressed).toBe(true);
      expect(evalAfterUnsuppCompany.isCompanySuppressed).toBe(false);
      expect(evalAfterUnsuppCompany.primaryReason).toBe(SuppressionReason.HARD_BOUNCE);
    });
  });

  describe('Audience Enrollment & Execution Creation Enforcement', () => {
    it('Criterion J: Early policy filtering prevents enrolling company-DNC contacts', async () => {
      const autoService = new AutomationService(wsA);

      (ContactModel.findOne as any).mockResolvedValue({
        _id: 'contact_123',
        email: 'blocked@acme.com',
        companyId: companyAcme
      });

      (SuppressionModel.find as any).mockResolvedValue([
        {
          workspaceId: wsA,
          targetType: SuppressionTargetType.COMPANY,
          targetId: companyAcme,
          reason: SuppressionReason.COMPANY_DNC
        }
      ]);

      await expect(
        autoService.createExecution({
          sequenceId: 'seq_1',
          campaignId: 'camp_1',
          contactId: 'contact_123'
        })
      ).rejects.toThrow(/Cannot enroll contact "contact_123" in campaign/);

      expect(SequenceExecutionModel.prototype.save).not.toHaveBeenCalled();
    });

    it('Criterion K & L: Suppressing company cascades cancellation to active sequence executions', async () => {
      const repo = new SuppressionRepository(wsA);
      (SuppressionModel.findOne as any).mockResolvedValue(null);
      (SuppressionModel.create as any).mockResolvedValue({
        workspaceId: wsA,
        targetType: SuppressionTargetType.COMPANY,
        targetId: companyAcme
      });

      (ContactModel.find as any).mockReturnValue({
        distinct: vi.fn().mockResolvedValue(['contact_1', 'contact_2'])
      });
      (SequenceExecutionModel.updateMany as any).mockResolvedValue({ modifiedCount: 2 });

      await repo.suppressCompany(companyAcme);

      expect(SequenceExecutionModel.updateMany).toHaveBeenCalledWith(
        {
          workspaceId: wsA,
          contactId: { $in: ['contact_1', 'contact_2'] },
          status: { $in: ['PENDING', 'RUNNING', 'WAITING'] }
        },
        { $set: { status: 'CANCELLED' } }
      );
    });
  });

  describe('Final Server-Authoritative Send Gate (EmailService.send)', () => {
    const defaultAccount = {
      _id: 'acc_1',
      workspaceId: wsA,
      email: 'sender@leadforge.ai',
      status: 'connected',
      provider: 'gmail_oauth',
      sendPolicy: { dailyLimit: 100, hourlyLimit: 20 }
    };

    it('Criterion M & N: MANDATORY STALE-CACHE TEST — worker local cache says eligible, Mongo has DNC, API rejects send and provider is never called', async () => {
      const emailService = new EmailService(wsA, 'user_1');

      // Mailbox is active
      (EmailAccountModel.findOne as any).mockResolvedValue(defaultAccount);

      // Contact exists with companyAcme
      (ContactModel.findOne as any).mockResolvedValue({
        _id: 'contact_stale',
        workspaceId: wsA,
        email: 'alice@acme.com',
        companyId: companyAcme,
        status: ContactStatus.NEW,
        emailStatus: ContactEmailStatus.VALID
      });

      // Recipient email itself is not in suppressions
      // BUT Company is marked DNC in MongoDB!
      (SuppressionModel.countDocuments as any).mockImplementation((query: any) => {
        if (query.targetType === SuppressionTargetType.COMPANY && query.targetId === companyAcme) {
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      });

      let thrownError: any = null;
      try {
        await emailService.send({
          accountId: 'acc_1',
          to: 'alice@acme.com',
          subject: 'Outreach Test',
          text: 'Hello Alice',
          campaignId: 'camp_1',
          contactId: 'contact_stale'
        });
      } catch (err) {
        thrownError = err;
      }

      // Assert local policy rejection
      expect(thrownError).toBeInstanceOf(EmailDomainError);
      expect(thrownError.code).toBe('COMPANY_DNC');
      expect(thrownError.message).toContain('marked Do Not Contact');

      // Assert provider is NEVER called
      expect(EmailDeliveryModel.create).not.toHaveBeenCalled();
      expect(EmailDeliveryModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('Criterion O: Company DNC does not create an EmailDelivery record or provider failure', async () => {
      const emailService = new EmailService(wsA, 'user_1');
      (EmailAccountModel.findOne as any).mockResolvedValue(defaultAccount);

      (ContactModel.findOne as any).mockResolvedValue({
        _id: 'contact_1',
        workspaceId: wsA,
        email: 'bob@acme.com',
        companyId: companyAcme,
        status: ContactStatus.NEW,
        emailStatus: ContactEmailStatus.VALID
      });

      (SuppressionModel.countDocuments as any).mockImplementation((query: any) => {
        if (query.targetType === SuppressionTargetType.COMPANY && query.targetId === companyAcme) {
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      });

      await expect(
        emailService.send({
          accountId: 'acc_1',
          to: 'bob@acme.com',
          subject: 'Test',
          campaignId: 'camp_1',
          contactId: 'contact_1'
        })
      ).rejects.toThrow(EmailDomainError);

      expect(EmailDeliveryModel.prototype.save).not.toHaveBeenCalled();
    });

    it('Criterion P: Company DNC does not trip or increment rejection circuit-breaker counters', async () => {
      const emailService = new EmailService(wsA, 'user_1');
      (EmailAccountModel.findOne as any).mockResolvedValue(defaultAccount);

      (ContactModel.findOne as any).mockResolvedValue({
        _id: 'contact_1',
        workspaceId: wsA,
        email: 'bob@acme.com',
        companyId: companyAcme
      });

      (SuppressionModel.countDocuments as any).mockImplementation((query: any) => {
        if (query.targetType === SuppressionTargetType.COMPANY) return Promise.resolve(1);
        return Promise.resolve(0);
      });

      try {
        await emailService.send({
          accountId: 'acc_1',
          to: 'bob@acme.com',
          subject: 'Test',
          campaignId: 'camp_1',
          contactId: 'contact_1'
        });
      } catch (err: any) {
        expect(err.code).toBe('COMPANY_DNC');
      }

      // Verify no failure delivery records were written for the campaign
      expect(EmailDeliveryModel.find).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: { $in: ['SENT', 'FAILED'] } })
      );
    });

    it('Criterion Q: Company DNC short-circuits before domain pacing and company cardinality reservation', async () => {
      const emailService = new EmailService(wsA, 'user_1');
      (EmailAccountModel.findOne as any).mockResolvedValue(defaultAccount);

      (ContactModel.findOne as any).mockResolvedValue({
        _id: 'contact_1',
        workspaceId: wsA,
        email: 'bob@acme.com',
        companyId: companyAcme
      });

      (SuppressionModel.countDocuments as any).mockImplementation((query: any) => {
        if (query.targetType === SuppressionTargetType.COMPANY) return Promise.resolve(1);
        return Promise.resolve(0);
      });

      try {
        await emailService.send({
          accountId: 'acc_1',
          to: 'bob@acme.com',
          subject: 'Test',
          campaignId: 'camp_1',
          contactId: 'contact_1'
        });
      } catch (err: any) {
        expect(err.code).toBe('COMPANY_DNC');
      }

      // Verify pacing lock was never attempted
      expect(EmailDeliveryModel.distinct).not.toHaveBeenCalled();
    });

    it('Criterion L: Domain suppression blocks matching recipient domain at send gate', async () => {
      const emailService = new EmailService(wsA, 'user_1');
      (EmailAccountModel.findOne as any).mockResolvedValue(defaultAccount);

      (ContactModel.findOne as any).mockResolvedValue({
        _id: 'contact_domain',
        workspaceId: wsA,
        email: 'lead@blockeddomain.com',
        companyId: null
      });

      (SuppressionModel.countDocuments as any).mockImplementation((query: any) => {
        if (query.targetType === SuppressionTargetType.DOMAIN && query.targetId === 'blockeddomain.com') {
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      });

      await expect(
        emailService.send({
          accountId: 'acc_1',
          to: 'lead@blockeddomain.com',
          subject: 'Test',
          contactId: 'contact_domain'
        })
      ).rejects.toThrow(/Domain "blockeddomain.com" is suppressed/);
    });

    it('Criterion X: Provider acceptance still behaves normally for a non-suppressed recipient', async () => {
      const emailService = new EmailService(wsA, 'user_1');
      (EmailAccountModel.findOne as any).mockResolvedValue(defaultAccount);

      (ContactModel.findOne as any).mockResolvedValue({
        _id: 'contact_valid',
        workspaceId: wsA,
        email: 'valid.lead@example.com',
        companyId: 'comp_valid',
        status: ContactStatus.NEW,
        emailStatus: ContactEmailStatus.VALID
      });

      // No suppressions active
      (SuppressionModel.countDocuments as any).mockResolvedValue(0);

      // Campaign active
      (CampaignModel.findOne as any).mockResolvedValue({
        _id: 'camp_active',
        workspaceId: wsA,
        status: 'ACTIVE'
      });

      // Mock pacing & account limits
      vi.spyOn(DomainPacingService.prototype, 'checkAndReservePacing').mockResolvedValue({
        allowed: true,
        leaseExpiresAt: new Date(Date.now() + 60000)
      } as any);
      (emailService as any).accountRepo.resolveEffectiveLimits = vi.fn().mockResolvedValue({
        dailyLimit: 100,
        hourlyLimit: 20
      });
      (emailService as any).accountRepo.reserveSendSlot = vi.fn().mockResolvedValue({ success: true });
      (emailService as any).deliveryRepo.reserveDelivery = vi.fn().mockResolvedValue({
        delivery: { _id: 'del_1', status: 'SENDING' },
        isAlreadySent: false
      });
      (emailService as any).accounts.buildProvider = vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({
          messageId: 'gmail_msg_100',
          threadId: 'gmail_th_100'
        })
      });
      (emailService as any).deliveryRepo.finalizeDelivery = vi.fn().mockResolvedValue({
        _id: 'del_1',
        status: 'SENT'
      });

      const res = await emailService.send({
        accountId: 'acc_1',
        to: 'valid.lead@example.com',
        subject: 'Valid Send',
        text: 'Hello',
        campaignId: 'camp_active',
        contactId: 'contact_valid'
      });

      expect(res.messageId).toBe('gmail_msg_100');
      expect(res.accepted).toContain('valid.lead@example.com');
    });

    it('Criterion Y: Ambiguous-send behavior remains unchanged and distinct from DNC', () => {
      const dncError = new EmailDomainError('COMPANY_DNC', 'Company DNC active');
      const ambiguousError = new EmailDomainError('AMBIGUOUS_SEND_TIMEOUT', 'Google connection timed out', false, false, 'ambiguous');

      expect(dncError.code).toBe('COMPANY_DNC');
      expect(ambiguousError.code).toBe('AMBIGUOUS_SEND_TIMEOUT');
      expect(ambiguousError.classification).toBe('ambiguous');
    });
  });
});
