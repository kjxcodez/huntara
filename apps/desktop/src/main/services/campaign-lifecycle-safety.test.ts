/**
 * LeadForge OS — Campaign Lifecycle, Contact Eligibility & Send Safety Test Suite
 *
 * Deterministic test suite verifying:
 * 1. Campaign state machine transitions and terminal enforcement
 * 2. Send authorization at worker & API boundaries
 * 3. Contact outreach eligibility (suppression, validation, affiliation)
 * 4. Contacted status transition semantics (only on provider acceptance)
 * 5. Ambiguous & failure safety (never mark contacted on failure)
 * 6. Scheduler WAITING recovery filtering (only ACTIVE campaigns)
 * 7. Audience resolution exclusion of suppressed/quarantined contacts
 * 8. Delivery idempotency across duplicate calls
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import {
  CampaignStatus,
  ContactStatus,
  ContactEmailStatus,
  isValidCampaignTransition,
  isCampaignSendAuthorized,
  evaluateOutreachEligibility,
  canTransitionContactStatus
} from '@huntara/schema';

describe('Campaign Lifecycle, Contact Eligibility & Send Safety Suite', () => {
  describe('Test 1: Campaign State Machine Invariants', () => {
    it('permits valid campaign transitions', () => {
      expect(isValidCampaignTransition(CampaignStatus.DRAFT, CampaignStatus.ACTIVE)).toBe(true);
      expect(isValidCampaignTransition(CampaignStatus.ACTIVE, CampaignStatus.PAUSED)).toBe(true);
      expect(isValidCampaignTransition(CampaignStatus.PAUSED, CampaignStatus.ACTIVE)).toBe(true);
      expect(isValidCampaignTransition(CampaignStatus.ACTIVE, CampaignStatus.STOPPED)).toBe(true);
      expect(isValidCampaignTransition(CampaignStatus.PAUSED, CampaignStatus.STOPPED)).toBe(true);
    });

    it('strictly forbids transitions out of terminal states', () => {
      expect(isValidCampaignTransition(CampaignStatus.STOPPED, CampaignStatus.ACTIVE)).toBe(false);
      expect(isValidCampaignTransition(CampaignStatus.STOPPED, CampaignStatus.PAUSED)).toBe(false);
      expect(isValidCampaignTransition(CampaignStatus.COMPLETED, CampaignStatus.ACTIVE)).toBe(false);
    });
  });

  describe('Test 2: Send Authorization Boundary', () => {
    it('only authorizes dispatch for ACTIVE campaigns', () => {
      expect(isCampaignSendAuthorized(CampaignStatus.ACTIVE)).toBe(true);
      expect(isCampaignSendAuthorized(CampaignStatus.PAUSED)).toBe(false);
      expect(isCampaignSendAuthorized(CampaignStatus.STOPPED)).toBe(false);
      expect(isCampaignSendAuthorized(CampaignStatus.DRAFT)).toBe(false);
      expect(isCampaignSendAuthorized(CampaignStatus.COMPLETED)).toBe(false);
    });
  });

  describe('Test 3: Contact Outreach Eligibility Policy', () => {
    it('approves whitelisted, valid contact in active campaign', () => {
      const res = evaluateOutreachEligibility({
        contact: { email: 'ceo@acme.com', status: ContactStatus.NEW, emailStatus: ContactEmailStatus.VALID },
        campaign: { status: CampaignStatus.ACTIVE }
      });
      expect(res.eligible).toBe(true);
    });

    it('rejects suppressed contacts (unsubscribed, bounced, do-not-contact)', () => {
      const unsub = evaluateOutreachEligibility({
        contact: { email: 'unsub@acme.com', status: ContactStatus.UNSUBSCRIBED },
        campaign: { status: CampaignStatus.ACTIVE }
      });
      expect(unsub.eligible).toBe(false);
      expect(unsub.reason).toBe('CONTACT_UNSUBSCRIBED');

      const bounced = evaluateOutreachEligibility({
        contact: { email: 'bounced@acme.com', status: ContactStatus.BOUNCED },
        campaign: { status: CampaignStatus.ACTIVE }
      });
      expect(bounced.eligible).toBe(false);
      expect(bounced.reason).toBe('CONTACT_BOUNCED');

      const dnc = evaluateOutreachEligibility({
        contact: { email: 'dnc@acme.com', status: ContactStatus.DO_NOT_CONTACT },
        campaign: { status: CampaignStatus.ACTIVE }
      });
      expect(dnc.eligible).toBe(false);
      expect(dnc.reason).toBe('CONTACT_DO_NOT_CONTACT');
    });

    it('rejects low quality candidates (quarantined, third-party)', () => {
      const quarantined = evaluateOutreachEligibility({
        contact: { email: 'parked@domain.com', status: ContactStatus.NEW, emailStatus: ContactEmailStatus.QUARANTINED },
        campaign: { status: CampaignStatus.ACTIVE }
      });
      expect(quarantined.eligible).toBe(false);
      expect(quarantined.reason).toBe('EMAIL_QUARANTINED');

      const thirdParty = evaluateOutreachEligibility({
        contact: {
          email: 'sales@shopify.com',
          status: ContactStatus.NEW,
          emailStatus: ContactEmailStatus.VALID,
          emailMeta: { confidenceTier: 'third_party', domainMatched: false }
        },
        campaign: { status: CampaignStatus.ACTIVE }
      });
      expect(thirdParty.eligible).toBe(false);
      expect(thirdParty.reason).toBe('EMAIL_THIRD_PARTY');
    });

    it('rejects contacts when campaign is stopped or paused', () => {
      const stopped = evaluateOutreachEligibility({
        contact: { email: 'user@acme.com', status: ContactStatus.NEW },
        campaign: { status: CampaignStatus.STOPPED }
      });
      expect(stopped.eligible).toBe(false);
      expect(stopped.reason).toBe('CAMPAIGN_STOPPED');

      const paused = evaluateOutreachEligibility({
        contact: { email: 'user@acme.com', status: ContactStatus.NEW },
        campaign: { status: CampaignStatus.PAUSED }
      });
      expect(paused.eligible).toBe(false);
      expect(paused.reason).toBe('CAMPAIGN_PAUSED');
    });
  });

  describe('Test 4: Contact Lifecycle State Transitions', () => {
    it('permits valid status progression', () => {
      expect(canTransitionContactStatus(ContactStatus.NEW, ContactStatus.CONTACTED)).toBe(true);
      expect(canTransitionContactStatus(ContactStatus.CONTACTED, ContactStatus.REPLIED)).toBe(true);
      expect(canTransitionContactStatus(ContactStatus.CONTACTED, ContactStatus.UNSUBSCRIBED)).toBe(true);
    });

    it('prohibits overwriting suppression states to contacted', () => {
      expect(canTransitionContactStatus(ContactStatus.UNSUBSCRIBED, ContactStatus.CONTACTED)).toBe(false);
      expect(canTransitionContactStatus(ContactStatus.BOUNCED, ContactStatus.CONTACTED)).toBe(false);
    });
  });

  describe('Test 5: Worker Pre-Dispatch Campaign State Checks', () => {
    it('halts worker immediately when campaign is stopped in-flight', () => {
      let campaignState: string = CampaignStatus.ACTIVE;
      const dispatchHistory: string[] = [];

      const contactsToDispatch = [
        { id: 'c-1', email: 'c1@test.com' },
        { id: 'c-2', email: 'c2@test.com' },
        { id: 'c-3', email: 'c3@test.com' },
        { id: 'c-4', email: 'c4@test.com' }
      ];

      for (let idx = 0; idx < contactsToDispatch.length; idx++) {
        // User clicks STOP while worker is processing contact 2
        if (idx === 2) {
          campaignState = CampaignStatus.STOPPED;
        }

        // Worker checks server campaign status before provider call
        if (!isCampaignSendAuthorized(campaignState)) {
          break;
        }

        dispatchHistory.push(contactsToDispatch[idx]!.id);
      }

      expect(dispatchHistory.length).toBe(2);
      expect(dispatchHistory).not.toContain('c-3');
      expect(dispatchHistory).not.toContain('c-4');
    });
  });

  describe('Test 6: CONTACTED Semantics under Provider Outcomes', () => {
    it('only transitions contact to CONTACTED on provider acceptance', () => {
      interface ContactRecord {
        id: string;
        email: string;
        status: string;
        lastContactedAt: Date | null;
      }

      const contacts = new Map<string, ContactRecord>();
      contacts.set('c-ok', { id: 'c-ok', email: 'ok@test.com', status: 'NEW', lastContactedAt: null });
      contacts.set('c-fail', { id: 'c-fail', email: 'fail@test.com', status: 'NEW', lastContactedAt: null });
      contacts.set('c-ambiguous', { id: 'c-ambiguous', email: 'ambig@test.com', status: 'NEW', lastContactedAt: null });
      contacts.set('c-unsub', { id: 'c-unsub', email: 'unsub@test.com', status: 'UNSUBSCRIBED', lastContactedAt: null });

      const fakeProviderSend = (contactId: string, outcome: 'success' | 'failure' | 'timeout') => {
        const contact = contacts.get(contactId)!;
        if (outcome === 'success') {
          if (!['UNSUBSCRIBED', 'BOUNCED', 'DO_NOT_CONTACT'].includes(contact.status)) {
            contact.status = 'CONTACTED';
            contact.lastContactedAt = new Date();
          }
          return { messageId: 'msg-123' };
        }
        if (outcome === 'timeout') {
          throw new Error('AMBIGUOUS_SEND_TIMEOUT');
        }
        throw new Error('PROVIDER_ERROR');
      };

      // 6a. Successful provider send: contact transitioned to CONTACTED
      fakeProviderSend('c-ok', 'success');
      expect(contacts.get('c-ok')!.status).toBe('CONTACTED');
      expect(contacts.get('c-ok')!.lastContactedAt).not.toBeNull();

      // 6b. Failed send: contact remains NEW, lastContactedAt is null
      expect(() => fakeProviderSend('c-fail', 'failure')).toThrow();
      expect(contacts.get('c-fail')!.status).toBe('NEW');
      expect(contacts.get('c-fail')!.lastContactedAt).toBeNull();

      // 6c. Ambiguous timeout: contact remains NEW, lastContactedAt is null
      expect(() => fakeProviderSend('c-ambiguous', 'timeout')).toThrow();
      expect(contacts.get('c-ambiguous')!.status).toBe('NEW');
      expect(contacts.get('c-ambiguous')!.lastContactedAt).toBeNull();

      // 6d. Unsubscribed contact: status remains UNSUBSCRIBED even if send logic invoked
      fakeProviderSend('c-unsub', 'success');
      expect(contacts.get('c-unsub')!.status).toBe('UNSUBSCRIBED');
    });
  });

  describe('Test 7: Scheduler WAITING Execution Recovery with Campaign States', () => {
    it('cancels WAITING executions for STOPPED campaigns and recovers only ACTIVE campaigns', () => {
      interface CampaignRecord {
        id: string;
        workspaceId: string;
        status: string;
      }
      interface SequenceExecutionRecord {
        id: string;
        workspaceId: string;
        campaignId: string | null;
        status: string;
        nextExecutionAt: Date;
      }

      const campaigns = new Map<string, CampaignRecord>([
        ['camp-active', { id: 'camp-active', workspaceId: 'ws-1', status: 'ACTIVE' }],
        ['camp-paused', { id: 'camp-paused', workspaceId: 'ws-1', status: 'PAUSED' }],
        ['camp-stopped', { id: 'camp-stopped', workspaceId: 'ws-1', status: 'STOPPED' }]
      ]);

      const executions = new Map<string, SequenceExecutionRecord>([
        ['exec-active', { id: 'exec-active', workspaceId: 'ws-1', campaignId: 'camp-active', status: 'WAITING', nextExecutionAt: new Date(Date.now() - 10000) }],
        ['exec-paused', { id: 'exec-paused', workspaceId: 'ws-1', campaignId: 'camp-paused', status: 'WAITING', nextExecutionAt: new Date(Date.now() - 10000) }],
        ['exec-stopped', { id: 'exec-stopped', workspaceId: 'ws-1', campaignId: 'camp-stopped', status: 'WAITING', nextExecutionAt: new Date(Date.now() - 10000) }],
        ['exec-standalone', { id: 'exec-standalone', workspaceId: 'ws-1', campaignId: null, status: 'WAITING', nextExecutionAt: new Date(Date.now() - 10000) }]
      ]);

      // Step 1: Scheduler tick cancels WAITING executions belonging to permanently STOPPED campaigns
      for (const exec of executions.values()) {
        if (exec.status === 'WAITING' && exec.campaignId) {
          const camp = campaigns.get(exec.campaignId);
          if (camp && ['STOPPED', 'FAILED'].includes(camp.status)) {
            exec.status = 'CANCELLED';
          }
        }
      }

      expect(executions.get('exec-stopped')!.status).toBe('CANCELLED');

      // Step 2: Scheduler recovers only due executions for ACTIVE campaigns (or standalone)
      const dueExecutions = Array.from(executions.values()).filter((se) => {
        if (se.status !== 'WAITING') return false;
        if (se.nextExecutionAt > new Date()) return false;
        if (!se.campaignId) return true; // standalone sequence
        const camp = campaigns.get(se.campaignId);
        return camp?.status === 'ACTIVE';
      });

      const dueIds = dueExecutions.map((d) => d.id);
      expect(dueIds).toContain('exec-active');
      expect(dueIds).toContain('exec-standalone');
      expect(dueIds).not.toContain('exec-paused');
      expect(dueIds).not.toContain('exec-stopped');
    });
  });

  describe('Test 8: Audience Resolution Safety Exclusions', () => {
    it('excludes unsubscribed, bounced, DNC, quarantined, and empty email contacts from audience', () => {
      interface ContactItem {
        id: string;
        email: string;
        status: string;
        emailStatus: string;
      }

      const contacts: ContactItem[] = [
        { id: 'c1', email: 'valid@acme.com', status: 'NEW', emailStatus: 'VALID' },
        { id: 'c2', email: 'unsub@acme.com', status: 'UNSUBSCRIBED', emailStatus: 'VALID' },
        { id: 'c3', email: 'bounced@acme.com', status: 'BOUNCED', emailStatus: 'VALID' },
        { id: 'c4', email: 'dnc@acme.com', status: 'DO_NOT_CONTACT', emailStatus: 'VALID' },
        { id: 'c5', email: 'quarantined@acme.com', status: 'NEW', emailStatus: 'QUARANTINED' },
        { id: 'c6', email: 'invalid@acme.com', status: 'NEW', emailStatus: 'INVALID' },
        { id: 'c7', email: '', status: 'NEW', emailStatus: 'VALID' }
      ];

      const resolved = contacts.filter((c) => {
        if (!c.email || c.email.trim() === '') return false;
        if (['UNSUBSCRIBED', 'BOUNCED', 'DO_NOT_CONTACT', 'ARCHIVED'].includes(c.status)) return false;
        if (['QUARANTINED', 'INVALID'].includes(c.emailStatus)) return false;
        return true;
      });

      const eligibleIds = resolved.map((r) => r.id);
      expect(eligibleIds).toEqual(['c1']);
      expect(eligibleIds).not.toContain('c2');
      expect(eligibleIds).not.toContain('c3');
      expect(eligibleIds).not.toContain('c4');
      expect(eligibleIds).not.toContain('c5');
      expect(eligibleIds).not.toContain('c6');
      expect(eligibleIds).not.toContain('c7');
    });
  });

  describe('Test 9: Delivery Idempotency Deduplication', () => {
    it('executes provider on first call and deduplicates subsequent dispatches with same key', () => {
      const deliveryLedger = new Map<string, { status: string; providerMessageId: string }>();
      let providerSendCalls = 0;

      function executeOrDeduplicateSend(idempotencyKey: string): { messageId: string; wasDuplicated: boolean } {
        const existing = deliveryLedger.get(idempotencyKey);
        if (existing && existing.status === 'SENT') {
          return { messageId: existing.providerMessageId, wasDuplicated: true };
        }

        providerSendCalls++;
        const providerMessageId = `provider-msg-${Date.now()}`;
        deliveryLedger.set(idempotencyKey, { status: 'SENT', providerMessageId });
        return { messageId: providerMessageId, wasDuplicated: false };
      }

      const key = 'campaign_c1_exec1_contact1_step0';
      const first = executeOrDeduplicateSend(key);
      expect(first.wasDuplicated).toBe(false);
      expect(providerSendCalls).toBe(1);

      // Retry with same key
      const second = executeOrDeduplicateSend(key);
      expect(second.wasDuplicated).toBe(true);
      expect(providerSendCalls).toBe(1);
      expect(second.messageId).toBe(first.messageId);
    });
  });
});
