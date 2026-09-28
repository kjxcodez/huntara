import { z } from 'zod';
import { EmailQualityStatus } from '../enums/index.js';

/**
 * HUNTARA — Authoritative Metric and Analytics Dictionary
 *
 * Guaranteed Invariants:
 * 1. Every rate metric exposes its explicit numerator, denominator, formula, and caveats.
 * 2. Never conflates provider acceptance with inbox delivery.
 * 3. Never conflates tracking requests with guaranteed human reading.
 * 4. Deduplicates unique recipients/deliveries accurately.
 */

// ── Metric With Explicit Denominator ──────────────────────────────────────────

export const metricWithDenominatorSchema = z.object({
  value: z.number(),
  formatted: z.string(),
  numerator: z.number(),
  denominator: z.number(),
  formula: z.string(),
  description: z.string(),
  limitations: z.string().nullable().optional()
});
export type MetricWithDenominator = z.infer<typeof metricWithDenominatorSchema>;

export function createMetricWithDenominator(
  numerator: number,
  denominator: number,
  formula: string,
  description: string,
  formatType: 'percent' | 'count' | 'ratio' = 'percent',
  limitations: string | null = null
): MetricWithDenominator {
  const safeDenom = denominator <= 0 ? 0 : denominator;
  const rawValue = safeDenom === 0 ? 0 : (numerator / safeDenom);
  let formatted = '0.00%';

  if (formatType === 'percent') {
    formatted = `${(rawValue * 100).toFixed(2)}%`;
  } else if (formatType === 'ratio') {
    formatted = `${rawValue.toFixed(2)}`;
  } else {
    formatted = `${numerator.toLocaleString()} / ${safeDenom.toLocaleString()}`;
  }

  return {
    value: rawValue,
    formatted,
    numerator,
    denominator: safeDenom,
    formula,
    description,
    limitations: limitations || null
  };
}

// ── Funnel Stage ─────────────────────────────────────────────────────────────

export const campaignFunnelStageSchema = z.object({
  stage: z.string(),
  label: z.string(),
  count: z.number(),
  conversionRate: z.number(),
  formattedConversionRate: z.string(),
  dropoffCount: z.number(),
  dropoffRate: z.number(),
  denominator: z.number(),
  formula: z.string(),
  isTerminal: z.boolean().default(false),
  note: z.string().nullable().optional()
});
export type CampaignFunnelStage = z.infer<typeof campaignFunnelStageSchema>;

// ── Raw Volume Counts ────────────────────────────────────────────────────────

export const campaignVolumeCountsSchema = z.object({
  contactsEnrolled: z.number(),
  contactsEligible: z.number(),
  contactsSuppressed: z.number(),
  emailsScheduled: z.number(),
  emailsQueued: z.number(),
  emailsAttempted: z.number(),
  emailsAccepted: z.number(),
  emailsFailed: z.number(),
  emailsAmbiguous: z.number(),
  observedOpens: z.number(),
  uniqueOpenedDeliveries: z.number(),
  uniqueOpenedContacts: z.number(),
  observedClicks: z.number(),
  uniqueClickedDeliveries: z.number(),
  uniqueClickedContacts: z.number(),
  repliesReceived: z.number(),
  replyingContacts: z.number(),
  hardBounces: z.number(),
  softBounces: z.number(),
  sequencesStoppedByReply: z.number(),
  sequencesCompleted: z.number(),
  sequencesCancelled: z.number()
});
export type CampaignVolumeCounts = z.infer<typeof campaignVolumeCountsSchema>;

// ── Performance Rates ────────────────────────────────────────────────────────

export const campaignRatesSchema = z.object({
  contactReplyRate: metricWithDenominatorSchema,
  messageReplyRate: metricWithDenominatorSchema,
  observedOpenRate: metricWithDenominatorSchema,
  uniqueOpenRate: metricWithDenominatorSchema,
  observedClickRate: metricWithDenominatorSchema,
  uniqueClickRate: metricWithDenominatorSchema,
  clickToOpenRate: metricWithDenominatorSchema,
  providerAcceptanceRate: metricWithDenominatorSchema,
  hardBounceRate: metricWithDenominatorSchema,
  suppressionRate: metricWithDenominatorSchema
});
export type CampaignRates = z.infer<typeof campaignRatesSchema>;

// ── Reply Latency ────────────────────────────────────────────────────────────

export const replyLatencySchema = z.object({
  minHours: z.number(),
  medianHours: z.number(),
  averageHours: z.number(),
  p90Hours: z.number(),
  totalRepliesCalculated: z.number(),
  sampleSizeNote: z.string()
});
export type ReplyLatency = z.infer<typeof replyLatencySchema>;

// ── Campaign Overview ────────────────────────────────────────────────────────

export const campaignAnalyticsOverviewSchema = z.object({
  campaignId: z.string(),
  campaignName: z.string(),
  status: z.string(),
  timezone: z.string(),
  timeRange: z.object({
    startDate: z.string().nullable(),
    endDate: z.string().nullable()
  }),
  counts: campaignVolumeCountsSchema,
  rates: campaignRatesSchema,
  funnel: z.array(campaignFunnelStageSchema),
  latency: replyLatencySchema,
  attributionConfidence: z.object({
    directThread: z.number(),
    directHeader: z.number(),
    contactMatch: z.number()
  }),
  computedAt: z.string()
});
export type CampaignAnalyticsOverview = z.infer<typeof campaignAnalyticsOverviewSchema>;

// ── Sequence Step Analytics ──────────────────────────────────────────────────

export const sequenceStepAnalyticsSchema = z.object({
  stepIndex: z.number(),
  stepName: z.string(),
  stepType: z.string(),
  delayDays: z.number().default(0),
  templateId: z.string().nullable().optional(),
  templateSubject: z.string().nullable().optional(),
  contactsEntered: z.number(),
  eligible: z.number(),
  accepted: z.number(),
  failed: z.number(),
  observedOpens: z.number(),
  uniqueOpens: z.number(),
  observedClicks: z.number(),
  uniqueClicks: z.number(),
  replies: z.number(),
  bounces: z.number(),
  stopped: z.number(),
  acceptanceRate: metricWithDenominatorSchema,
  openRate: metricWithDenominatorSchema,
  replyRate: metricWithDenominatorSchema,
  bounceRate: metricWithDenominatorSchema
});
export type SequenceStepAnalytics = z.infer<typeof sequenceStepAnalyticsSchema>;

// ── Time-Series / Timeline Point ─────────────────────────────────────────────

export const campaignTimelinePointSchema = z.object({
  timestamp: z.string(), // ISO date (bucket boundary)
  label: z.string(), // Formatted e.g. "2026-09-01" or "09:00"
  attempted: z.number(),
  accepted: z.number(),
  observedOpens: z.number(),
  observedClicks: z.number(),
  replies: z.number(),
  bounces: z.number(),
  failures: z.number()
});
export type CampaignTimelinePoint = z.infer<typeof campaignTimelinePointSchema>;

// ── Mailbox / Sender Analytics ───────────────────────────────────────────────

export const mailboxSenderAnalyticsSchema = z.object({
  accountId: z.string(),
  email: z.string(),
  name: z.string().nullable().optional(),
  provider: z.string(),
  status: z.string(),
  dailyLimit: z.number(),
  dailySent: z.number(),
  attempted: z.number(),
  accepted: z.number(),
  failed: z.number(),
  ambiguous: z.number(),
  bounced: z.number(),
  replies: z.number(),
  observedOpens: z.number(),
  observedClicks: z.number(),
  acceptanceRate: metricWithDenominatorSchema,
  lastSentAt: z.string().nullable().optional(),
  cooldownRemainingSec: z.number().nullable().optional(),
  rateLimited: z.boolean()
});
export type MailboxSenderAnalytics = z.infer<typeof mailboxSenderAnalyticsSchema>;

// ── Audience Quality Breakdown ───────────────────────────────────────────────

export const audienceQualitySegmentSchema = z.object({
  status: z.nativeEnum(EmailQualityStatus),
  label: z.string(),
  count: z.number(),
  percentage: z.number(),
  accepted: z.number(),
  bounced: z.number(),
  replied: z.number(),
  bounceRate: z.number()
});
export type AudienceQualitySegment = z.infer<typeof audienceQualitySegmentSchema>;

export const audienceQualityBreakdownSchema = z.object({
  totalEnrolled: z.number(),
  segments: z.array(audienceQualitySegmentSchema)
});
export type AudienceQualityBreakdown = z.infer<typeof audienceQualityBreakdownSchema>;

// ── Comparison DTO ───────────────────────────────────────────────────────────

export const campaignComparisonItemSchema = z.object({
  campaignId: z.string(),
  campaignName: z.string(),
  status: z.string(),
  enrolled: z.number(),
  accepted: z.number(),
  uniqueOpens: z.number(),
  uniqueOpenRate: z.number(),
  replies: z.number(),
  replyRate: z.number(),
  bounces: z.number(),
  bounceRate: z.number(),
  medianReplyHours: z.number()
});
export type CampaignComparisonItem = z.infer<typeof campaignComparisonItemSchema>;

export const campaignComparisonResultSchema = z.object({
  campaigns: z.array(campaignComparisonItemSchema),
  comparedAt: z.string(),
  notes: z.array(z.string())
});
export type CampaignComparisonResult = z.infer<typeof campaignComparisonResultSchema>;

// ── Query Schemas ────────────────────────────────────────────────────────────

export const campaignAnalyticsQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  timezone: z.string().optional(),
  stepIndex: z.coerce.number().optional(),
  accountId: z.string().optional()
});
export type CampaignAnalyticsQuery = z.infer<typeof campaignAnalyticsQuerySchema>;

export const campaignCompareQuerySchema = z.object({
  campaignIds: z.union([z.string(), z.array(z.string())]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  timezone: z.string().optional()
});
export type CampaignCompareQuery = z.infer<typeof campaignCompareQuerySchema>;

// ── Export Schema ────────────────────────────────────────────────────────────

export const campaignExportRowSchema = z.object({
  metric: z.string(),
  value: z.union([z.string(), z.number()]),
  numerator: z.number().nullable().optional(),
  denominator: z.number().nullable().optional(),
  formula: z.string().nullable().optional(),
  description: z.string().nullable().optional()
});
export type CampaignExportRow = z.infer<typeof campaignExportRowSchema>;

export const campaignAnalyticsExportSchema = z.object({
  metadata: z.object({
    campaignId: z.string(),
    campaignName: z.string(),
    workspaceId: z.string(),
    exportedAt: z.string(),
    timezone: z.string(),
    timeRange: z.object({
      startDate: z.string().nullable(),
      endDate: z.string().nullable()
    })
  }),
  metrics: z.array(campaignExportRowSchema),
  steps: z.array(z.record(z.any())),
  timeline: z.array(campaignTimelinePointSchema),
  csvContent: z.string().optional()
});
export type CampaignAnalyticsExport = z.infer<typeof campaignAnalyticsExportSchema>;
