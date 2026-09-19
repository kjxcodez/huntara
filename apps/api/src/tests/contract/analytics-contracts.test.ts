import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { analyticsRouter } from '../../routes/analytics.js';
import { CampaignAnalyticsService } from '../../services/analytics/campaign-analytics.service.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { createMetricWithDenominator, EmailQualityStatus } from '@huntara/schema';

vi.mock('../../services/analytics/campaign-analytics.service.js');

describe('Campaign Analytics Route Contracts', () => {
  let app: OpenAPIHono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new OpenAPIHono();
    app.onError(errorHandler);
  });

  it('enforces workspace context requirement (HTTP 403 / Forbidden)', async () => {
    app.route('/analytics', analyticsRouter);

    const res = await app.request('/analytics/campaigns/camp_123/overview', {
      method: 'GET'
    });

    expect(res.status).toBe(403);
  });

  describe('Authenticated Analytics Endpoints', () => {
    beforeEach(() => {
      app.use('*', async (c, next) => {
        (c as any).set('workspaceId', 'ws_test_p11');
        await next();
      });
      app.route('/analytics', analyticsRouter);
    });

    it('GET /analytics/campaigns/:id/overview returns 200 with complete metrics and formulas', async () => {
      const mockOverview = {
        campaignId: 'camp_123',
        campaignName: 'Test Outreach',
        status: 'ACTIVE',
        timezone: 'UTC',
        timeRange: { startDate: null, endDate: null },
        counts: {
          contactsEnrolled: 100,
          contactsEligible: 95,
          contactsSuppressed: 5,
          emailsScheduled: 100,
          emailsQueued: 0,
          emailsAttempted: 95,
          emailsAccepted: 90,
          emailsFailed: 5,
          emailsAmbiguous: 0,
          observedOpens: 40,
          uniqueOpenedDeliveries: 35,
          uniqueOpenedContacts: 35,
          observedClicks: 10,
          uniqueClickedDeliveries: 8,
          uniqueClickedContacts: 8,
          repliesReceived: 7,
          replyingContacts: 6,
          hardBounces: 2,
          softBounces: 3,
          sequencesStoppedByReply: 6,
          sequencesCompleted: 20,
          sequencesCancelled: 0
        },
        rates: {
          contactReplyRate: createMetricWithDenominator(6, 95, '6/95', 'desc'),
          messageReplyRate: createMetricWithDenominator(7, 90, '7/90', 'desc'),
          observedOpenRate: createMetricWithDenominator(40, 90, '40/90', 'desc'),
          uniqueOpenRate: createMetricWithDenominator(35, 90, '35/90', 'desc'),
          observedClickRate: createMetricWithDenominator(10, 90, '10/90', 'desc'),
          uniqueClickRate: createMetricWithDenominator(8, 90, '8/90', 'desc'),
          clickToOpenRate: createMetricWithDenominator(8, 35, '8/35', 'desc'),
          providerAcceptanceRate: createMetricWithDenominator(90, 95, '90/95', 'desc'),
          hardBounceRate: createMetricWithDenominator(2, 95, '2/95', 'desc'),
          suppressionRate: createMetricWithDenominator(5, 100, '5/100', 'desc')
        },
        funnel: [],
        latency: {
          minHours: 1,
          medianHours: 3.5,
          averageHours: 6.2,
          p90Hours: 14,
          totalRepliesCalculated: 6,
          sampleSizeNote: '6 replies'
        },
        attributionConfidence: {
          directThread: 5,
          directHeader: 1,
          contactMatch: 0
        },
        computedAt: new Date().toISOString()
      };

      CampaignAnalyticsService.prototype.getOverview = vi.fn().mockResolvedValue(mockOverview);

      const res = await app.request('/analytics/campaigns/camp_123/overview', {
        method: 'GET'
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.campaignId).toBe('camp_123');
      expect(json.data.rates.contactReplyRate.numerator).toBe(6);
      expect(json.data.rates.contactReplyRate.denominator).toBe(95);
      expect(json.data.rates.contactReplyRate.formatted).toBe('6.32%');
    });

    it('GET /analytics/campaigns/:id/timeline returns 200 with timeline points and timezone', async () => {
      const mockTimeline = {
        points: [
          {
            timestamp: '2026-09-01',
            label: '2026-09-01',
            attempted: 50,
            accepted: 48,
            observedOpens: 20,
            observedClicks: 5,
            replies: 3,
            bounces: 1,
            failures: 2
          }
        ],
        timezone: 'America/New_York'
      };

      CampaignAnalyticsService.prototype.getTimeline = vi.fn().mockResolvedValue(mockTimeline);

      const res = await app.request('/analytics/campaigns/camp_123/timeline?timezone=America/New_York', {
        method: 'GET'
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.timezone).toBe('America/New_York');
      expect(json.data.points.length).toBe(1);
      expect(json.data.points[0].accepted).toBe(48);
    });

    it('GET /analytics/campaigns/:id/steps returns 200 with sequence step breakdown', async () => {
      const mockSteps = [
        {
          stepIndex: 0,
          stepName: 'Step 1: SEND_EMAIL',
          stepType: 'SEND_EMAIL',
          delayDays: 0,
          templateId: 'tpl_1',
          templateSubject: null,
          contactsEntered: 50,
          eligible: 50,
          accepted: 48,
          failed: 2,
          observedOpens: 25,
          uniqueOpens: 20,
          observedClicks: 6,
          uniqueClicks: 5,
          replies: 4,
          bounces: 1,
          stopped: 4,
          acceptanceRate: createMetricWithDenominator(48, 50, '48/50', 'desc'),
          openRate: createMetricWithDenominator(20, 48, '20/48', 'desc'),
          replyRate: createMetricWithDenominator(4, 48, '4/48', 'desc'),
          bounceRate: createMetricWithDenominator(1, 50, '1/50', 'desc')
        }
      ];

      CampaignAnalyticsService.prototype.getStepAnalytics = vi.fn().mockResolvedValue(mockSteps);

      const res = await app.request('/analytics/campaigns/camp_123/steps', {
        method: 'GET'
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.steps.length).toBe(1);
      expect(json.data.steps[0].stepName).toBe('Step 1: SEND_EMAIL');
    });

    it('GET /analytics/campaigns/:id/mailboxes returns 200 with mailbox sender breakdown', async () => {
      const mockMailboxes = [
        {
          accountId: 'acc_1',
          email: 'outreach@leadforge.dev',
          name: 'Primary Sender',
          provider: 'gmail_oauth',
          status: 'ACTIVE',
          dailyLimit: 200,
          dailySent: 48,
          attempted: 50,
          accepted: 48,
          failed: 2,
          ambiguous: 0,
          bounced: 1,
          replies: 4,
          observedOpens: 20,
          observedClicks: 5,
          acceptanceRate: createMetricWithDenominator(48, 50, '48/50', 'desc'),
          lastSentAt: new Date().toISOString(),
          cooldownRemainingSec: null,
          rateLimited: false
        }
      ];

      CampaignAnalyticsService.prototype.getMailboxAnalytics = vi.fn().mockResolvedValue(mockMailboxes);

      const res = await app.request('/analytics/campaigns/camp_123/mailboxes', {
        method: 'GET'
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.mailboxes[0].email).toBe('outreach@leadforge.dev');
    });

    it('GET /analytics/campaigns/:id/quality returns 200 with audience quality breakdown', async () => {
      const mockQuality = {
        totalEnrolled: 100,
        segments: [
          {
            status: EmailQualityStatus.MX_VALID,
            label: 'MX VALID',
            count: 80,
            percentage: 80,
            accepted: 78,
            bounced: 2,
            replied: 5,
            bounceRate: 2.5
          }
        ]
      };

      CampaignAnalyticsService.prototype.getQualityBreakdown = vi.fn().mockResolvedValue(mockQuality);

      const res = await app.request('/analytics/campaigns/camp_123/quality', {
        method: 'GET'
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.segments[0].status).toBe(EmailQualityStatus.MX_VALID);
    });

    it('GET /analytics/campaigns/compare returns 200 with comparative analysis', async () => {
      const mockComparison = {
        campaigns: [
          {
            campaignId: 'c1',
            campaignName: 'Campaign A',
            status: 'ACTIVE',
            enrolled: 100,
            accepted: 90,
            uniqueOpens: 30,
            uniqueOpenRate: 0.33,
            replies: 5,
            replyRate: 0.05,
            bounces: 2,
            bounceRate: 0.02,
            medianReplyHours: 4
          }
        ],
        comparedAt: new Date().toISOString(),
        notes: ['Sample size caution']
      };

      CampaignAnalyticsService.compareCampaigns = vi.fn().mockResolvedValue(mockComparison);

      const res = await app.request('/analytics/campaigns/compare?campaignIds=c1,c2', {
        method: 'GET'
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.campaigns.length).toBe(1);
    });

    it('GET /analytics/campaigns/:id/export?format=csv returns CSV file download with text/csv header', async () => {
      const mockExport = {
        metadata: {
          campaignId: 'camp_123',
          campaignName: 'Test Campaign',
          workspaceId: 'ws_test_p11',
          exportedAt: new Date().toISOString(),
          timezone: 'UTC',
          timeRange: { startDate: null, endDate: null }
        },
        metrics: [],
        steps: [],
        timeline: [],
        csvContent: 'Metric,Value\nContacts Enrolled,100\nProvider Accepted,90'
      };

      CampaignAnalyticsService.prototype.exportCampaign = vi.fn().mockResolvedValue(mockExport);

      const res = await app.request('/analytics/campaigns/camp_123/export?format=csv', {
        method: 'GET'
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      const text = await res.text();
      expect(text).toContain('Contacts Enrolled,100');
    });
  });
});
