/**
 * LeadForge OS — Phase 1: Safe Optional Email Tracking Test Suite
 *
 * Requirements Verified:
 * A. Campaign Default: New campaigns serialize with trackingEnabled === false
 * B. Tracking Disabled: Outbound HTML and plaintext contain NO open pixel, NO rewritten links,
 *    original links preserved, and no tracking tokens created.
 * C. Tracking Enabled: Open pixel injected, click links rewritten, tracking metadata preserved.
 * D. Invalid Tracking Configuration (Fail-Closed): When tracking is enabled, invalid/localhost/empty
 *    URLs cause the send to fail closed before provider dispatch.
 * E. Tracking Disabled + Invalid Config: When tracking is disabled, sends proceed normally without error.
 * F. Legacy Campaigns: Existing campaigns without trackingEnabled resolve deterministically to tracking OFF.
 * G. No Localhost Leakage: Under no circumstances can localhost/127.0.0.1/0.0.0.0 leak into outbound mail.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService } from './email.service.js';
import { CampaignModel } from '../../db/models/campaign.model.js';
import { ContactModel } from '../../db/models/contact.model.js';
import { SuppressionModel } from '../../db/models/suppression.model.js';
import { EmailAccountModel } from '../../db/models/email-account.model.js';
import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { DomainPacingService } from '../outreach/domain-pacing.service.js';
import {
  createCampaignDtoSchema,
  campaignSchema,
  ContactStatus,
  ContactEmailStatus
} from '@leadforge/schema';
import { EmailDomainError } from './types.js';

vi.mock('../../db/models/suppression.model.js');
vi.mock('../../db/models/contact.model.js');
vi.mock('../../db/models/campaign.model.js');
vi.mock('../../db/models/email-delivery.model.js');
vi.mock('../../db/models/email-account.model.js');

describe('Phase 1: Safe Optional Email Tracking', () => {
  const wsId = 'ws_track_test';
  const originalEnv = process.env;

  const defaultAccount = {
    _id: 'acc_test_1',
    workspaceId: wsId,
    email: 'outreach@leadforge.pro',
    status: 'connected',
    provider: 'gmail_oauth',
    sendPolicy: { dailyLimit: 100, hourlyLimit: 20 }
  };

  const defaultContact = {
    _id: 'contact_test_1',
    workspaceId: wsId,
    email: 'prospect@acme.com',
    status: ContactStatus.NEW,
    emailStatus: ContactEmailStatus.VALID
  };

  let mockSend: any;
  let mockUpdateDelivery: any;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.TRACKING_BASE_URL;
    delete process.env.API_BASE_URL;

    mockSend = vi.fn().mockResolvedValue({
      messageId: 'gmail_msg_success_100',
      threadId: 'gmail_th_success_100'
    });

    mockUpdateDelivery = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    (EmailDeliveryModel.updateOne as any) = mockUpdateDelivery;
    (EmailDeliveryModel.findOne as any).mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function setupEmailServiceMocks(emailService: EmailService) {
    (EmailAccountModel.findOne as any).mockResolvedValue(defaultAccount);
    (ContactModel.findOne as any).mockResolvedValue(defaultContact);
    (SuppressionModel.countDocuments as any).mockResolvedValue(0);

    vi.spyOn(DomainPacingService.prototype, 'checkAndReservePacing').mockResolvedValue({
      allowed: true,
      leaseExpiresAt: new Date(Date.now() + 60000),
      releaseDomainLease: vi.fn().mockResolvedValue(undefined)
    } as any);

    (emailService as any).accountRepo.resolveEffectiveLimits = vi.fn().mockResolvedValue({
      dailyLimit: 100,
      hourlyLimit: 20
    });
    (emailService as any).accountRepo.reserveSendSlot = vi.fn().mockResolvedValue({ success: true });
    (emailService as any).accountRepo.releaseSendSlot = vi.fn().mockResolvedValue(undefined);

    (emailService as any).deliveryRepo.reserveDelivery = vi.fn().mockResolvedValue({
      delivery: {
        _id: 'del_track_1',
        workspaceId: wsId,
        status: 'SENDING',
        openTrackingToken: null,
        clickTrackingTokens: []
      },
      isAlreadySent: false
    });

    (emailService as any).accounts.buildProvider = vi.fn().mockResolvedValue({
      send: mockSend
    });

    (emailService as any).deliveryRepo.finalizeDelivery = vi.fn().mockResolvedValue({
      _id: 'del_track_1',
      status: 'SENT'
    });
  }

  // ── A. Campaign Default ───────────────────────────────────────────────────
  describe('A. Campaign Default', () => {
    it('defaults trackingEnabled to false when creating a new campaign', () => {
      const parsed = createCampaignDtoSchema.parse({
        name: 'Q4 Cold Outreach'
      });
      expect(parsed.trackingEnabled).toBe(false);
    });

    it('defaults trackingEnabled to false in entity campaignSchema when absent', () => {
      const parsed = campaignSchema.parse({
        id: 'camp_1',
        workspaceId: wsId,
        name: 'Existing Campaign',
        status: 'ACTIVE',
        steps: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      expect(parsed.trackingEnabled).toBe(false);
    });
  });

  // ── B. Tracking Disabled Behavior ─────────────────────────────────────────
  describe('B. Tracking Disabled Behavior', () => {
    it('sends original HTML with NO open pixel, NO rewritten links, and NO tracking tokens', async () => {
      process.env.TRACKING_BASE_URL = 'https://api.leadforge.kapiljangid.pro';

      const emailService = new EmailService(wsId, 'user_1');
      setupEmailServiceMocks(emailService);

      (CampaignModel.findOne as any).mockResolvedValue({
        _id: 'camp_untracked',
        workspaceId: wsId,
        status: 'ACTIVE',
        trackingEnabled: false
      });

      const originalHtml = '<p>Check our website: <a href="https://linkedin.com/company/acme">Acme LinkedIn</a></p>';
      const originalText = 'Check our website: https://linkedin.com/company/acme';

      const result = await emailService.send({
        accountId: 'acc_test_1',
        to: 'prospect@acme.com',
        subject: 'Collaboration Opportunity',
        html: originalHtml,
        text: originalText,
        campaignId: 'camp_untracked'
      });

      expect(result.messageId).toBe('gmail_msg_success_100');
      expect(mockSend).toHaveBeenCalledTimes(1);

      const providerCall = mockSend.mock.calls[0][0];

      // 1. NO open pixel in HTML
      expect(providerCall.html).not.toContain('/t/open/');
      expect(providerCall.html).not.toContain('/tracking/open/');
      expect(providerCall.html).not.toContain('<img');

      // 2. NO rewritten click links
      expect(providerCall.html).not.toContain('/t/click/');
      expect(providerCall.html).not.toContain('/tracking/click/');
      expect(providerCall.html).toContain('href="https://linkedin.com/company/acme"');

      // 3. Exact original text body preserved
      expect(providerCall.text).toBe(originalText);

      // 4. Delivery record persisted with NO tracking tokens
      expect(mockUpdateDelivery).toHaveBeenCalledWith(
        { _id: 'del_track_1' },
        expect.objectContaining({
          $set: expect.objectContaining({
            openTrackingToken: null,
            clickTrackingTokens: []
          })
        })
      );
    });

    it('sends plaintext email with no tracking metadata when tracking is disabled', async () => {
      const emailService = new EmailService(wsId, 'user_1');
      setupEmailServiceMocks(emailService);

      (CampaignModel.findOne as any).mockResolvedValue({
        _id: 'camp_untracked_plain',
        workspaceId: wsId,
        status: 'ACTIVE',
        trackingEnabled: false
      });

      const result = await emailService.send({
        accountId: 'acc_test_1',
        to: 'prospect@acme.com',
        subject: 'Plain text note',
        text: 'Hello from plain text email',
        campaignId: 'camp_untracked_plain'
      });

      expect(result.messageId).toBe('gmail_msg_success_100');
      expect(mockSend).toHaveBeenCalledTimes(1);

      const providerCall = mockSend.mock.calls[0][0];
      expect(providerCall.text).toBe('Hello from plain text email');
      expect(mockUpdateDelivery).toHaveBeenCalledWith(
        { _id: 'del_track_1' },
        expect.objectContaining({
          $set: expect.objectContaining({
            openTrackingToken: null,
            clickTrackingTokens: []
          })
        })
      );
    });
  });

  // ── C. Tracking Enabled Behavior ──────────────────────────────────────────
  describe('C. Tracking Enabled Behavior', () => {
    it('injects open pixel and rewrites click links when trackingEnabled is explicitly true with valid HTTPS URL', async () => {
      process.env.TRACKING_BASE_URL = 'https://api.leadforge.kapiljangid.pro';

      const emailService = new EmailService(wsId, 'user_1');
      setupEmailServiceMocks(emailService);

      (CampaignModel.findOne as any).mockResolvedValue({
        _id: 'camp_tracked',
        workspaceId: wsId,
        status: 'ACTIVE',
        trackingEnabled: true
      });

      const rawHtml = '<p>Visit our platform: <a href="https://example.com/demo">Demo Link</a></p>';

      const result = await emailService.send({
        accountId: 'acc_test_1',
        to: 'prospect@acme.com',
        subject: 'Tracked Outreach',
        html: rawHtml,
        campaignId: 'camp_tracked'
      });

      expect(result.messageId).toBe('gmail_msg_success_100');
      expect(mockSend).toHaveBeenCalledTimes(1);

      const providerCall = mockSend.mock.calls[0][0];

      // 1. Open pixel injected using secure tracking base
      expect(providerCall.html).toContain('https://api.leadforge.kapiljangid.pro/t/open/');
      expect(providerCall.html).toContain('<img src="https://api.leadforge.kapiljangid.pro/t/open/');

      // 2. Click URL rewritten to secure tracking redirect
      expect(providerCall.html).toContain('https://api.leadforge.kapiljangid.pro/t/click/');
      expect(providerCall.html).not.toContain('href="https://example.com/demo"');

      // 3. Delivery record updated with non-empty tracking metadata
      expect(mockUpdateDelivery).toHaveBeenCalledWith(
        { _id: 'del_track_1' },
        expect.objectContaining({
          $set: expect.objectContaining({
            openTrackingToken: expect.stringMatching(/^[a-f0-9]{32}$/),
            clickTrackingTokens: expect.arrayContaining([
              expect.objectContaining({
                targetUrl: 'https://example.com/demo',
                token: expect.stringMatching(/^[a-f0-9]{32}$/)
              })
            ])
          })
        })
      );
    });
  });

  // ── D. Invalid Tracking Configuration Fail-Closed ─────────────────────────
  describe('D. Invalid Tracking Configuration (Fail-Closed)', () => {
    const invalidUrls = [
      { name: 'localhost with port', url: 'http://localhost:3000' },
      { name: 'localhost https', url: 'https://localhost:3000' },
      { name: '127.0.0.1 loopback', url: 'http://127.0.0.1:3000' },
      { name: '0.0.0.0 zero ip', url: 'http://0.0.0.0:3000' },
      { name: 'malformed string', url: 'not-a-valid-url' },
      { name: 'empty string', url: '' },
      { name: 'missing environment variable', url: undefined }
    ];

    for (const item of invalidUrls) {
      it(`fails closed when tracking is enabled and tracking URL is ${item.name}`, async () => {
        if (item.url !== undefined) {
          process.env.TRACKING_BASE_URL = item.url;
        } else {
          delete process.env.TRACKING_BASE_URL;
          delete process.env.API_BASE_URL;
        }

        const emailService = new EmailService(wsId, 'user_1');
        setupEmailServiceMocks(emailService);

        (CampaignModel.findOne as any).mockResolvedValue({
          _id: 'camp_tracked_invalid',
          workspaceId: wsId,
          status: 'ACTIVE',
          trackingEnabled: true
        });

        await expect(
          emailService.send({
            accountId: 'acc_test_1',
            to: 'prospect@acme.com',
            subject: 'Invalid Tracking Test',
            html: '<p><a href="https://example.com">Link</a></p>',
            campaignId: 'camp_tracked_invalid'
          })
        ).rejects.toThrowError(
          /Email tracking is enabled, but the configured tracking URL is invalid/
        );

        // Crucial invariant: provider.send must NEVER be invoked!
        expect(mockSend).not.toHaveBeenCalled();
      });
    }
  });

  // ── E. Tracking Disabled + Invalid Config ──────────────────────────────────
  describe('E. Tracking Disabled + Invalid Configuration', () => {
    it('allows normal email dispatch when tracking is OFF even if TRACKING_BASE_URL is invalid or unset', async () => {
      process.env.TRACKING_BASE_URL = 'http://localhost:3000'; // deliberately invalid configuration

      const emailService = new EmailService(wsId, 'user_1');
      setupEmailServiceMocks(emailService);

      (CampaignModel.findOne as any).mockResolvedValue({
        _id: 'camp_untracked_safe',
        workspaceId: wsId,
        status: 'ACTIVE',
        trackingEnabled: false
      });

      const rawHtml = '<p>Company: <a href="https://acme.org">Acme Org</a></p>';

      const res = await emailService.send({
        accountId: 'acc_test_1',
        to: 'prospect@acme.com',
        subject: 'Safe Send Despite Broken Tracking URL',
        html: rawHtml,
        campaignId: 'camp_untracked_safe'
      });

      expect(res.messageId).toBe('gmail_msg_success_100');
      expect(mockSend).toHaveBeenCalledTimes(1);

      const providerCall = mockSend.mock.calls[0][0];
      // Sent cleanly without any tracking injection
      expect(providerCall.html).not.toContain('localhost');
      expect(providerCall.html).not.toContain('/t/open/');
      expect(providerCall.html).not.toContain('/t/click/');
      expect(providerCall.html).toContain('href="https://acme.org"');
    });
  });

  // ── F. Existing / Legacy Campaigns ────────────────────────────────────────
  describe('F. Existing / Legacy Campaigns', () => {
    it('treats existing campaigns where trackingEnabled is undefined/absent as tracking OFF', async () => {
      process.env.TRACKING_BASE_URL = 'https://api.leadforge.kapiljangid.pro';

      const emailService = new EmailService(wsId, 'user_1');
      setupEmailServiceMocks(emailService);

      // Legacy campaign document in MongoDB lacking trackingEnabled field
      (CampaignModel.findOne as any).mockResolvedValue({
        _id: 'camp_legacy_document',
        workspaceId: wsId,
        name: 'Old Campaign 2025',
        status: 'ACTIVE'
        // trackingEnabled is undefined!
      });

      const rawHtml = '<p>Check out our <a href="https://example.com/product">Product</a></p>';

      const res = await emailService.send({
        accountId: 'acc_test_1',
        to: 'prospect@acme.com',
        subject: 'Legacy Campaign Outreach',
        html: rawHtml,
        campaignId: 'camp_legacy_document'
      });

      expect(res.messageId).toBe('gmail_msg_success_100');
      expect(mockSend).toHaveBeenCalledTimes(1);

      const providerCall = mockSend.mock.calls[0][0];
      // Legacy campaigns must NOT be silently tracked
      expect(providerCall.html).not.toContain('/t/open/');
      expect(providerCall.html).not.toContain('/t/click/');
      expect(providerCall.html).toContain('href="https://example.com/product"');
    });
  });

  // ── G. Zero Localhost Leakage Regression ──────────────────────────────────
  describe('G. Zero Localhost Leakage Regression', () => {
    it('asserts that outbound email payloads never contain localhost, 127.0.0.1, or 0.0.0.0 as tracking endpoints', async () => {
      // In this test, no environment variables are set
      delete process.env.TRACKING_BASE_URL;
      delete process.env.API_BASE_URL;

      const emailService = new EmailService(wsId, 'user_1');
      setupEmailServiceMocks(emailService);

      (CampaignModel.findOne as any).mockResolvedValue({
        _id: 'camp_default_send',
        workspaceId: wsId,
        status: 'ACTIVE',
        trackingEnabled: false
      });

      const rawHtml = `
        <div style="font-family: Arial;">
          <h1>Welcome</h1>
          <p>Please review our <a href="https://legal.leadforge.pro/terms">Terms of Service</a>.</p>
        </div>
      `;

      const res = await emailService.send({
        accountId: 'acc_test_1',
        to: 'prospect@acme.com',
        subject: 'Regression Test: Zero Localhost Leakage',
        html: rawHtml,
        campaignId: 'camp_default_send'
      });

      expect(res.messageId).toBe('gmail_msg_success_100');
      const providerCall = mockSend.mock.calls[0][0];

      // String-level scan of the entire outbound payload delivered to Gmail provider
      const payloadString = JSON.stringify(providerCall);
      expect(payloadString).not.toContain('localhost');
      expect(payloadString).not.toContain('127.0.0.1');
      expect(payloadString).not.toContain('0.0.0.0');
      expect(payloadString).not.toContain('http://localhost:3000');
    });
  });
});
