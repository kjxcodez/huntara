import { OpenAPIHono } from '@hono/zod-openapi';
import { CampaignAnalyticsService } from '../services/analytics/campaign-analytics.service.js';
import {
  campaignAnalyticsQuerySchema,
  campaignCompareQuerySchema
} from '@huntara/schema';
import { successResponse } from '../utils/index.js';
import { getWorkspaceId } from './common.js';
import { BadRequestError } from '../errors/index.js';

export const analyticsRouter = new OpenAPIHono();

// 1. Campaign Analytics Overview & Funnel
analyticsRouter.get('/campaigns/:id/overview', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const query = c.req.query();
  const parsed = campaignAnalyticsQuerySchema.parse(query);

  const service = new CampaignAnalyticsService(wsId);
  const result = await service.getOverview(id, parsed);
  return c.json(successResponse(result));
});

// 2. Campaign Time-Series / Timeline
analyticsRouter.get('/campaigns/:id/timeline', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const query = c.req.query();
  const parsed = campaignAnalyticsQuerySchema.parse(query);

  const service = new CampaignAnalyticsService(wsId);
  const result = await service.getTimeline(id, parsed);
  return c.json(successResponse(result));
});

// 3. Campaign Sequence Step Performance
analyticsRouter.get('/campaigns/:id/steps', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');

  const service = new CampaignAnalyticsService(wsId);
  const steps = await service.getStepAnalytics(id);
  return c.json(successResponse({ steps }));
});

// 4. Campaign Mailbox / Sender Telemetry
analyticsRouter.get('/campaigns/:id/mailboxes', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');

  const service = new CampaignAnalyticsService(wsId);
  const mailboxes = await service.getMailboxAnalytics(id);
  return c.json(successResponse({ mailboxes }));
});

// 5. Campaign Audience Quality Breakdown
analyticsRouter.get('/campaigns/:id/quality', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');

  const service = new CampaignAnalyticsService(wsId);
  const result = await service.getQualityBreakdown(id);
  return c.json(successResponse(result));
});

// 6. Multi-Campaign Comparison
analyticsRouter.get('/campaigns/compare', async (c) => {
  const wsId = getWorkspaceId(c);
  const query = c.req.query();

  const campaignIdsParam = c.req.queries('campaignIds') || (query.campaignIds ? String(query.campaignIds).split(',') : []);
  if (!campaignIdsParam || campaignIdsParam.length === 0) {
    throw new BadRequestError('Query param "campaignIds" is required.');
  }

  const parsed = campaignCompareQuerySchema.parse({
    campaignIds: campaignIdsParam,
    startDate: query.startDate,
    endDate: query.endDate,
    timezone: query.timezone
  });

  const campaignIds = Array.isArray(parsed.campaignIds)
    ? parsed.campaignIds
    : [parsed.campaignIds];

  const result = await CampaignAnalyticsService.compareCampaigns(wsId, campaignIds, {
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    timezone: parsed.timezone
  });

  return c.json(successResponse(result));
});

// 7. Campaign Analytics Export (CSV / JSON)
analyticsRouter.get('/campaigns/:id/export', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const query = c.req.query();
  const format = query.format === 'csv' ? 'csv' : 'json';
  const parsed = campaignAnalyticsQuerySchema.parse(query);

  const service = new CampaignAnalyticsService(wsId);
  const result = await service.exportCampaign(id, parsed, format);

  if (format === 'csv' && result.csvContent) {
    return new Response(result.csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="campaign-${id}-analytics.csv"`
      }
    });
  }

  return c.json(successResponse(result));
});
