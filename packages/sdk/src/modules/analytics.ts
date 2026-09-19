import { HttpClient } from '../http/client.js';
import { toQueryString } from '../utils/query.js';
import type {
  CampaignAnalyticsOverview,
  CampaignTimelinePoint,
  SequenceStepAnalytics,
  MailboxSenderAnalytics,
  AudienceQualityBreakdown,
  CampaignComparisonResult,
  CampaignAnalyticsExport,
  CampaignAnalyticsQuery,
  CampaignCompareQuery
} from '@huntara/schema';

export class AnalyticsModule {
  constructor(private client: HttpClient) {}

  public readonly campaigns = {
    getOverview: async (
      campaignId: string,
      params?: CampaignAnalyticsQuery
    ): Promise<CampaignAnalyticsOverview> => {
      const q = toQueryString(params);
      return this.client.get<CampaignAnalyticsOverview>(`/analytics/campaigns/${campaignId}/overview${q}`);
    },

    getTimeline: async (
      campaignId: string,
      params?: CampaignAnalyticsQuery
    ): Promise<{ points: CampaignTimelinePoint[]; timezone: string }> => {
      const q = toQueryString(params);
      return this.client.get<{ points: CampaignTimelinePoint[]; timezone: string }>(
        `/analytics/campaigns/${campaignId}/timeline${q}`
      );
    },

    getSteps: async (campaignId: string): Promise<{ steps: SequenceStepAnalytics[] }> => {
      return this.client.get<{ steps: SequenceStepAnalytics[] }>(`/analytics/campaigns/${campaignId}/steps`);
    },

    getMailboxes: async (campaignId: string): Promise<{ mailboxes: MailboxSenderAnalytics[] }> => {
      return this.client.get<{ mailboxes: MailboxSenderAnalytics[] }>(`/analytics/campaigns/${campaignId}/mailboxes`);
    },

    getQuality: async (campaignId: string): Promise<AudienceQualityBreakdown> => {
      return this.client.get<AudienceQualityBreakdown>(`/analytics/campaigns/${campaignId}/quality`);
    },

    compare: async (params: CampaignCompareQuery): Promise<CampaignComparisonResult> => {
      const q = toQueryString(params);
      return this.client.get<CampaignComparisonResult>(`/analytics/campaigns/compare${q}`);
    },

    export: async (
      campaignId: string,
      params?: CampaignAnalyticsQuery & { format?: 'json' | 'csv' }
    ): Promise<CampaignAnalyticsExport> => {
      const q = toQueryString(params);
      return this.client.get<CampaignAnalyticsExport>(`/analytics/campaigns/${campaignId}/export${q}`);
    }
  };
}
