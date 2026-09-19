import mongoose from 'mongoose';
import { CampaignModel } from '../../db/models/campaign.model.js';
import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { EmailEventModel } from '../../db/models/email-event.model.js';
import { SequenceExecutionModel } from '../../db/models/sequence-execution.model.js';
import { SuppressionModel } from '../../db/models/suppression.model.js';
import { EmailAccountModel } from '../../db/models/email-account.model.js';
import { EmailQualityModel } from '../../db/models/email-quality.model.js';
import {
  type CampaignAnalyticsOverview,
  type CampaignTimelinePoint,
  type SequenceStepAnalytics,
  type MailboxSenderAnalytics,
  type AudienceQualityBreakdown,
  type CampaignComparisonResult,
  type CampaignAnalyticsExport,
  type CampaignAnalyticsQuery,
  type CampaignFunnelStage,
  createMetricWithDenominator,
  EmailQualityStatus,
  EmailEventType
} from '@huntara/schema';
import { NotFoundError, ValidationError } from '../../errors/index.js';

export class CampaignAnalyticsService {
  constructor(private readonly workspaceId: string) {}

  /**
   * Generates the authoritative overview metrics, funnel, rates, and latency for a campaign.
   */
  public async getOverview(
    campaignId: string,
    query: CampaignAnalyticsQuery = {}
  ): Promise<CampaignAnalyticsOverview> {
    const campaign = await CampaignModel.findOne({
      _id: campaignId,
      workspaceId: this.workspaceId,
      deletedAt: null
    });

    if (!campaign) {
      throw new NotFoundError(`Campaign with id "${campaignId}" not found.`);
    }

    const timezone = query.timezone || campaign.timezone || 'UTC';

    // 1. Delivery Match Filter
    const deliveryMatch: any = {
      workspaceId: this.workspaceId,
      campaignId,
      direction: 'OUTBOUND'
    };

    if (query.startDate || query.endDate) {
      deliveryMatch.createdAt = {};
      if (query.startDate) deliveryMatch.createdAt.$gte = new Date(query.startDate);
      if (query.endDate) deliveryMatch.createdAt.$lte = new Date(query.endDate);
    }

    if (query.stepIndex !== undefined && query.stepIndex !== null) {
      deliveryMatch.stepIndex = query.stepIndex;
    }

    if (query.accountId) {
      deliveryMatch.accountId = query.accountId;
    }

    // 2. Aggregate Outbound Deliveries
    const [deliveryAgg] = await EmailDeliveryModel.aggregate([
      { $match: deliveryMatch },
      {
        $group: {
          _id: null,
          totalAttempted: { $sum: 1 },
          accepted: {
            $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, 1, 0] }
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] }
          },
          ambiguous: {
            $sum: { $cond: [{ $or: [{ $eq: ['$status', 'AMBIGUOUS'] }, { $eq: ['$ambiguous', true] }] }, 1, 0] }
          },
          observedOpens: { $sum: '$openCount' },
          uniqueOpenedDeliveries: {
            $sum: { $cond: [{ $gt: ['$openCount', 0] }, 1, 0] }
          },
          observedClicks: { $sum: '$clickCount' },
          uniqueClickedDeliveries: {
            $sum: { $cond: [{ $gt: ['$clickCount', 0] }, 1, 0] }
          },
          repliesReceived: { $sum: '$replyCount' },
          hardBounces: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'FAILED'] },
                    {
                      $in: [
                        '$failureCategory',
                        ['INVALID_RECIPIENT', 'MAILBOX_UNAVAILABLE', 'DOMAIN_NOT_FOUND']
                      ]
                    }
                  ]
                },
                1,
                0
              ]
            }
          },
          softBounces: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'FAILED'] },
                    { $in: ['$failureCategory', ['RATE_LIMIT', 'NETWORK', 'PROVIDER']] }
                  ]
                },
                1,
                0
              ]
            }
          },
          distinctOpenedContacts: {
            $addToSet: {
              $cond: [{ $gt: ['$openCount', 0] }, '$contactId', null]
            }
          },
          distinctClickedContacts: {
            $addToSet: {
              $cond: [{ $gt: ['$clickCount', 0] }, '$contactId', null]
            }
          },
          distinctReplyingContacts: {
            $addToSet: {
              $cond: [{ $eq: ['$hasReply', true] }, '$contactId', null]
            }
          }
        }
      }
    ]);

    const attempted = deliveryAgg?.totalAttempted || 0;
    const accepted = deliveryAgg?.accepted || 0;
    const failed = deliveryAgg?.failed || 0;
    const ambiguous = deliveryAgg?.ambiguous || 0;
    const observedOpens = deliveryAgg?.observedOpens || 0;
    const uniqueOpenedDeliveries = deliveryAgg?.uniqueOpenedDeliveries || 0;
    const observedClicks = deliveryAgg?.observedClicks || 0;
    const uniqueClickedDeliveries = deliveryAgg?.uniqueClickedDeliveries || 0;
    const repliesReceived = deliveryAgg?.repliesReceived || 0;
    const hardBounces = deliveryAgg?.hardBounces || 0;
    const softBounces = deliveryAgg?.softBounces || 0;

    const uniqueOpenedContacts = (deliveryAgg?.distinctOpenedContacts || []).filter(Boolean).length;
    const uniqueClickedContacts = (deliveryAgg?.distinctClickedContacts || []).filter(Boolean).length;
    const replyingContacts = (deliveryAgg?.distinctReplyingContacts || []).filter(Boolean).length;

    // 3. Aggregate Sequence Executions (Enrollments)
    const [execAgg] = await SequenceExecutionModel.aggregate([
      {
        $match: {
          workspaceId: this.workspaceId,
          campaignId
        }
      },
      {
        $group: {
          _id: null,
          distinctEnrolled: { $addToSet: '$contactId' },
          stoppedByReply: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$status', 'replied'] },
                    { $gt: ['$replies', 0] }
                  ]
                },
                1,
                0
              ]
            }
          },
          completed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ['$status', ['completed', 'COMPLETED']] },
                    { $eq: ['$replies', 0] }
                  ]
                },
                1,
                0
              ]
            }
          },
          cancelled: {
            $sum: {
              $cond: [{ $in: ['$status', ['cancelled', 'CANCELLED', 'stopped', 'STOPPED']] }, 1, 0]
            }
          }
        }
      }
    ]);

    const enrolledContacts = (execAgg?.distinctEnrolled || []).filter(Boolean);
    const contactsEnrolled = enrolledContacts.length;
    const sequencesStoppedByReply = execAgg?.stoppedByReply || 0;
    const sequencesCompleted = execAgg?.completed || 0;
    const sequencesCancelled = execAgg?.cancelled || 0;

    // 4. Determine Enrolled Contacts Suppressed
    let contactsSuppressed = 0;
    if (enrolledContacts.length > 0) {
      contactsSuppressed = await SuppressionModel.countDocuments({
        workspaceId: this.workspaceId,
        $or: [
          { contactId: { $in: enrolledContacts } },
          { reason: { $exists: true } }
        ]
      }).catch(() => 0);
    }
    const contactsEligible = Math.max(0, contactsEnrolled - contactsSuppressed);

    // 5. Calculate Rates With Explicit Denominators
    const contactReplyRate = createMetricWithDenominator(
      replyingContacts,
      contactsEligible,
      `${replyingContacts} replying contacts / ${contactsEligible} eligible contacts = ${(
        (contactsEligible ? replyingContacts / contactsEligible : 0) * 100
      ).toFixed(2)}%`,
      'Percentage of eligible enrolled contacts who replied to outreach',
      'percent',
      'Uses eligible contacts enrolled as denominator; avoids multi-email inflation'
    );

    const messageReplyRate = createMetricWithDenominator(
      repliesReceived,
      accepted,
      `${repliesReceived} replies / ${accepted} provider accepted emails = ${(
        (accepted ? repliesReceived / accepted : 0) * 100
      ).toFixed(2)}%`,
      'Ratio of total inbound replies to provider accepted outbound emails',
      'percent',
      'Reflects message-level reply efficiency across all sequence steps'
    );

    const uniqueOpenRate = createMetricWithDenominator(
      uniqueOpenedDeliveries,
      accepted,
      `${uniqueOpenedDeliveries} opened deliveries / ${accepted} provider accepted emails = ${(
        (accepted ? uniqueOpenedDeliveries / accepted : 0) * 100
      ).toFixed(2)}%`,
      'Percentage of accepted outbound deliveries that observed at least one open pixel hit',
      'percent',
      'Subject to mail client pre-fetching (Apple MPP, Google proxy); labeled as observed'
    );

    const observedOpenRate = createMetricWithDenominator(
      observedOpens,
      accepted,
      `${observedOpens} total opens / ${accepted} provider accepted emails = ${(
        (accepted ? observedOpens / accepted : 0) * 100
      ).toFixed(2)}%`,
      'Total observed open tracking hits relative to provider accepted emails',
      'percent',
      'Includes multiple re-opens by the same recipient'
    );

    const uniqueClickRate = createMetricWithDenominator(
      uniqueClickedDeliveries,
      accepted,
      `${uniqueClickedDeliveries} clicked deliveries / ${accepted} provider accepted emails = ${(
        (accepted ? uniqueClickedDeliveries / accepted : 0) * 100
      ).toFixed(2)}%`,
      'Percentage of accepted deliveries observing at least one link click',
      'percent',
      'May include enterprise security link scanner activations'
    );

    const observedClickRate = createMetricWithDenominator(
      observedClicks,
      accepted,
      `${observedClicks} total clicks / ${accepted} provider accepted emails = ${(
        (accepted ? observedClicks / accepted : 0) * 100
      ).toFixed(2)}%`,
      'Total link click redirect events relative to provider accepted emails',
      'percent'
    );

    const clickToOpenRate = createMetricWithDenominator(
      uniqueClickedDeliveries,
      uniqueOpenedDeliveries,
      `${uniqueClickedDeliveries} clicked / ${uniqueOpenedDeliveries} opened deliveries = ${(
        (uniqueOpenedDeliveries ? uniqueClickedDeliveries / uniqueOpenedDeliveries : 0) * 100
      ).toFixed(2)}%`,
      'Click-to-Open Rate (CTOR): proportion of opened messages that generated a click',
      'percent'
    );

    const providerAcceptanceRate = createMetricWithDenominator(
      accepted,
      attempted,
      `${accepted} accepted / ${attempted} attempted = ${(
        (attempted ? accepted / attempted : 0) * 100
      ).toFixed(2)}%`,
      'Percentage of outbound dispatch attempts successfully accepted by the email provider',
      'percent',
      'Confirms dispatch acceptance; does not guarantee inbox placement or remote delivery'
    );

    const hardBounceRate = createMetricWithDenominator(
      hardBounces,
      attempted,
      `${hardBounces} hard bounces / ${attempted} attempted emails = ${(
        (attempted ? hardBounces / attempted : 0) * 100
      ).toFixed(2)}%`,
      'Proportion of outbound attempts resulting in permanent recipient/domain bounce',
      'percent'
    );

    const suppressionRate = createMetricWithDenominator(
      contactsSuppressed,
      contactsEnrolled,
      `${contactsSuppressed} suppressed / ${contactsEnrolled} enrolled contacts = ${(
        (contactsEnrolled ? contactsSuppressed / contactsEnrolled : 0) * 100
      ).toFixed(2)}%`,
      'Proportion of enrolled contacts blocked by active workspace suppression',
      'percent'
    );

    // 6. Compute Reply Latency
    const latencyDeliveries = await EmailDeliveryModel.find(
      {
        workspaceId: this.workspaceId,
        campaignId,
        direction: 'OUTBOUND',
        hasReply: true,
        sentAt: { $ne: null },
        lastRepliedAt: { $ne: null }
      },
      { sentAt: 1, lastRepliedAt: 1 }
    ).lean();

    const hoursList: number[] = [];
    for (const d of latencyDeliveries) {
      if (d.sentAt && d.lastRepliedAt) {
        const diffMs = new Date(d.lastRepliedAt).getTime() - new Date(d.sentAt).getTime();
        if (diffMs > 0) {
          hoursList.push(diffMs / 3600000);
        }
      }
    }

    hoursList.sort((a, b) => a - b);
    let minHours = 0;
    let medianHours = 0;
    let averageHours = 0;
    let p90Hours = 0;

    if (hoursList.length > 0) {
      minHours = Number(hoursList[0]?.toFixed(2)) || 0;
      const mid = Math.floor(hoursList.length / 2);
      medianHours = Number(
        (hoursList.length % 2 === 0
          ? (hoursList[mid - 1]! + hoursList[mid]!) / 2
          : hoursList[mid]!
        ).toFixed(2)
      );
      const sum = hoursList.reduce((acc, h) => acc + h, 0);
      averageHours = Number((sum / hoursList.length).toFixed(2));
      const p90Idx = Math.floor(hoursList.length * 0.9);
      p90Hours = Number((hoursList[p90Idx] || hoursList[hoursList.length - 1]!).toFixed(2));
    }

    // 7. Funnel Progression Stages
    const funnel: CampaignFunnelStage[] = [
      {
        stage: 'enrolled',
        label: 'Audience Enrolled',
        count: contactsEnrolled,
        conversionRate: 1.0,
        formattedConversionRate: '100.00%',
        dropoffCount: contactsSuppressed,
        dropoffRate: contactsEnrolled ? contactsSuppressed / contactsEnrolled : 0,
        denominator: contactsEnrolled,
        formula: `${contactsEnrolled} / ${contactsEnrolled}`,
        isTerminal: false,
        note: 'Total unique contacts targeted for this campaign'
      },
      {
        stage: 'eligible',
        label: 'Send-Eligible',
        count: contactsEligible,
        conversionRate: contactsEnrolled ? contactsEligible / contactsEnrolled : 0,
        formattedConversionRate: `${((contactsEnrolled ? contactsEligible / contactsEnrolled : 0) * 100).toFixed(2)}%`,
        dropoffCount: Math.max(0, contactsEligible - attempted),
        dropoffRate: contactsEligible ? Math.max(0, contactsEligible - attempted) / contactsEligible : 0,
        denominator: contactsEnrolled,
        formula: `${contactsEligible} / ${contactsEnrolled}`,
        isTerminal: false,
        note: 'Contacts free from active suppression or invalid status'
      },
      {
        stage: 'attempted',
        label: 'Outreach Attempted',
        count: attempted,
        conversionRate: contactsEligible ? attempted / contactsEligible : 0,
        formattedConversionRate: `${((contactsEligible ? attempted / contactsEligible : 0) * 100).toFixed(2)}%`,
        dropoffCount: failed,
        dropoffRate: attempted ? failed / attempted : 0,
        denominator: contactsEligible,
        formula: `${attempted} / ${contactsEligible}`,
        isTerminal: false,
        note: 'Messages dispatched to mail provider queue'
      },
      {
        stage: 'accepted',
        label: 'Provider Accepted',
        count: accepted,
        conversionRate: attempted ? accepted / attempted : 0,
        formattedConversionRate: `${((attempted ? accepted / attempted : 0) * 100).toFixed(2)}%`,
        dropoffCount: Math.max(0, accepted - uniqueOpenedDeliveries),
        dropoffRate: accepted ? Math.max(0, accepted - uniqueOpenedDeliveries) / accepted : 0,
        denominator: attempted,
        formula: `${accepted} / ${attempted}`,
        isTerminal: false,
        note: 'Accepted by mail provider (e.g. Gmail API HTTP 200)'
      },
      {
        stage: 'opened',
        label: 'Observed Opened',
        count: uniqueOpenedDeliveries,
        conversionRate: accepted ? uniqueOpenedDeliveries / accepted : 0,
        formattedConversionRate: `${((accepted ? uniqueOpenedDeliveries / accepted : 0) * 100).toFixed(2)}%`,
        dropoffCount: Math.max(0, uniqueOpenedDeliveries - uniqueClickedDeliveries),
        dropoffRate: uniqueOpenedDeliveries ? Math.max(0, uniqueOpenedDeliveries - uniqueClickedDeliveries) / uniqueOpenedDeliveries : 0,
        denominator: accepted,
        formula: `${uniqueOpenedDeliveries} / ${accepted}`,
        isTerminal: false,
        note: 'Deliveries observing tracking pixel activation'
      },
      {
        stage: 'clicked',
        label: 'Observed Clicked',
        count: uniqueClickedDeliveries,
        conversionRate: accepted ? uniqueClickedDeliveries / accepted : 0,
        formattedConversionRate: `${((accepted ? uniqueClickedDeliveries / accepted : 0) * 100).toFixed(2)}%`,
        dropoffCount: Math.max(0, uniqueClickedDeliveries - replyingContacts),
        dropoffRate: uniqueClickedDeliveries ? Math.max(0, uniqueClickedDeliveries - replyingContacts) / uniqueClickedDeliveries : 0,
        denominator: accepted,
        formula: `${uniqueClickedDeliveries} / ${accepted}`,
        isTerminal: false,
        note: 'Deliveries observing link click redirect'
      },
      {
        stage: 'replied',
        label: 'Replies Received',
        count: replyingContacts,
        conversionRate: contactsEligible ? replyingContacts / contactsEligible : 0,
        formattedConversionRate: `${((contactsEligible ? replyingContacts / contactsEligible : 0) * 100).toFixed(2)}%`,
        dropoffCount: 0,
        dropoffRate: 0,
        denominator: contactsEligible,
        formula: `${replyingContacts} replying contacts / ${contactsEligible} eligible`,
        isTerminal: true,
        note: 'Inbound prospect replies correlated to campaign context'
      }
    ];

    // 8. Attribution Confidence Breakdown
    const [attrAgg] = await EmailEventModel.aggregate([
      {
        $match: {
          workspaceId: this.workspaceId,
          campaignId,
          type: EmailEventType.REPLIED
        }
      },
      {
        $group: {
          _id: '$metadata.matchConfidence',
          count: { $sum: 1 }
        }
      }
    ]);

    const attributionConfidence = {
      directThread: 0,
      directHeader: 0,
      contactMatch: 0
    };

    if (attrAgg) {
      // aggregate can return array of grouped objects
      const allEvents = await EmailEventModel.find(
        { workspaceId: this.workspaceId, campaignId, type: EmailEventType.REPLIED },
        { 'metadata.matchConfidence': 1 }
      ).lean();

      for (const ev of allEvents) {
        const conf = ev.metadata?.matchConfidence;
        if (conf === 'thread') attributionConfidence.directThread++;
        else if (conf === 'header') attributionConfidence.directHeader++;
        else attributionConfidence.contactMatch++;
      }
    }

    return {
      campaignId,
      campaignName: campaign.name,
      status: campaign.status,
      timezone,
      timeRange: {
        startDate: query.startDate || null,
        endDate: query.endDate || null
      },
      counts: {
        contactsEnrolled,
        contactsEligible,
        contactsSuppressed,
        emailsScheduled: Math.max(0, (campaign.steps?.length || 1) * contactsEligible - attempted),
        emailsQueued: 0,
        emailsAttempted: attempted,
        emailsAccepted: accepted,
        emailsFailed: failed,
        emailsAmbiguous: ambiguous,
        observedOpens,
        uniqueOpenedDeliveries,
        uniqueOpenedContacts,
        observedClicks,
        uniqueClickedDeliveries,
        uniqueClickedContacts,
        repliesReceived,
        replyingContacts,
        hardBounces,
        softBounces,
        sequencesStoppedByReply,
        sequencesCompleted,
        sequencesCancelled
      },
      rates: {
        contactReplyRate,
        messageReplyRate,
        observedOpenRate,
        uniqueOpenRate,
        observedClickRate,
        uniqueClickRate,
        clickToOpenRate,
        providerAcceptanceRate,
        hardBounceRate,
        suppressionRate
      },
      funnel,
      latency: {
        minHours,
        medianHours,
        averageHours,
        p90Hours,
        totalRepliesCalculated: hoursList.length,
        sampleSizeNote: `Calculated across ${hoursList.length} correlated reply timestamps`
      },
      attributionConfidence,
      computedAt: new Date().toISOString()
    };
  }

  /**
   * Generates timezone-adjusted time-series data for chart rendering.
   */
  public async getTimeline(
    campaignId: string,
    query: CampaignAnalyticsQuery = {}
  ): Promise<{ points: CampaignTimelinePoint[]; timezone: string }> {
    const campaign = await CampaignModel.findOne({
      _id: campaignId,
      workspaceId: this.workspaceId,
      deletedAt: null
    });

    const timezone = query.timezone || campaign?.timezone || 'UTC';

    const match: any = {
      workspaceId: this.workspaceId,
      campaignId,
      direction: 'OUTBOUND',
      sentAt: { $ne: null }
    };

    if (query.startDate || query.endDate) {
      match.sentAt = {};
      if (query.startDate) match.sentAt.$gte = new Date(query.startDate);
      if (query.endDate) match.sentAt.$lte = new Date(query.endDate);
    }

    const points = await EmailDeliveryModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$sentAt',
              timezone
            }
          },
          attempted: { $sum: 1 },
          accepted: {
            $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, 1, 0] }
          },
          observedOpens: { $sum: '$openCount' },
          observedClicks: { $sum: '$clickCount' },
          replies: { $sum: '$replyCount' },
          bounces: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'FAILED'] },
                    {
                      $in: [
                        '$failureCategory',
                        ['INVALID_RECIPIENT', 'MAILBOX_UNAVAILABLE', 'DOMAIN_NOT_FOUND']
                      ]
                    }
                  ]
                },
                1,
                0
              ]
            }
          },
          failures: {
            $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          timestamp: '$_id',
          label: '$_id',
          attempted: 1,
          accepted: 1,
          observedOpens: 1,
          observedClicks: 1,
          replies: 1,
          bounces: 1,
          failures: 1
        }
      }
    ]);

    return { points, timezone };
  }

  /**
   * Computes sequence step breakdown with step-level acceptance, open, and reply rates.
   */
  public async getStepAnalytics(campaignId: string): Promise<SequenceStepAnalytics[]> {
    const campaign = await CampaignModel.findOne({
      _id: campaignId,
      workspaceId: this.workspaceId,
      deletedAt: null
    });

    if (!campaign) {
      throw new NotFoundError(`Campaign "${campaignId}" not found.`);
    }

    const steps = campaign.steps || [];
    const stepAnalytics: SequenceStepAnalytics[] = [];

    const deliveryAgg = await EmailDeliveryModel.aggregate([
      {
        $match: {
          workspaceId: this.workspaceId,
          campaignId,
          direction: 'OUTBOUND'
        }
      },
      {
        $group: {
          _id: '$stepIndex',
          attempted: { $sum: 1 },
          accepted: {
            $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, 1, 0] }
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] }
          },
          observedOpens: { $sum: '$openCount' },
          uniqueOpens: {
            $sum: { $cond: [{ $gt: ['$openCount', 0] }, 1, 0] }
          },
          observedClicks: { $sum: '$clickCount' },
          uniqueClicks: {
            $sum: { $cond: [{ $gt: ['$clickCount', 0] }, 1, 0] }
          },
          replies: { $sum: '$replyCount' },
          bounces: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'FAILED'] },
                    {
                      $in: [
                        '$failureCategory',
                        ['INVALID_RECIPIENT', 'MAILBOX_UNAVAILABLE', 'DOMAIN_NOT_FOUND']
                      ]
                    }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const stepMap = new Map<number, any>();
    for (const d of deliveryAgg) {
      stepMap.set(d._id ?? 0, d);
    }

    // Also count sequences stopped at each step
    const execAgg = await SequenceExecutionModel.aggregate([
      {
        $match: {
          workspaceId: this.workspaceId,
          campaignId,
          status: 'replied'
        }
      },
      {
        $group: {
          _id: '$currentStep',
          stopped: { $sum: 1 }
        }
      }
    ]);

    const stoppedMap = new Map<number, number>();
    for (const e of execAgg) {
      stoppedMap.set(e._id ?? 0, e.stopped);
    }

    for (let i = 0; i < Math.max(steps.length, 1); i++) {
      const stepDef = steps[i];
      const stats = stepMap.get(i) || {
        attempted: 0,
        accepted: 0,
        failed: 0,
        observedOpens: 0,
        uniqueOpens: 0,
        observedClicks: 0,
        uniqueClicks: 0,
        replies: 0,
        bounces: 0
      };

      const accepted = stats.accepted;
      const attempted = stats.attempted;
      const replies = stats.replies;
      const stopped = stoppedMap.get(i) || 0;

      stepAnalytics.push({
        stepIndex: i,
        stepName: stepDef ? `Step ${i + 1}: ${stepDef.type}` : `Step ${i + 1}`,
        stepType: stepDef?.type || 'SEND_EMAIL',
        delayDays: stepDef?.delayDays || 0,
        templateId: stepDef?.templateId || null,
        templateSubject: null,
        contactsEntered: attempted,
        eligible: attempted,
        accepted,
        failed: stats.failed,
        observedOpens: stats.observedOpens,
        uniqueOpens: stats.uniqueOpens,
        observedClicks: stats.observedClicks,
        uniqueClicks: stats.uniqueClicks,
        replies,
        bounces: stats.bounces,
        stopped,
        acceptanceRate: createMetricWithDenominator(
          accepted,
          attempted,
          `${accepted} / ${attempted} = ${((attempted ? accepted / attempted : 0) * 100).toFixed(2)}%`,
          'Step delivery acceptance rate'
        ),
        openRate: createMetricWithDenominator(
          stats.uniqueOpens,
          accepted,
          `${stats.uniqueOpens} / ${accepted} = ${((accepted ? stats.uniqueOpens / accepted : 0) * 100).toFixed(2)}%`,
          'Step unique open rate'
        ),
        replyRate: createMetricWithDenominator(
          replies,
          accepted,
          `${replies} / ${accepted} = ${((accepted ? replies / accepted : 0) * 100).toFixed(2)}%`,
          'Step reply rate'
        ),
        bounceRate: createMetricWithDenominator(
          stats.bounces,
          attempted,
          `${stats.bounces} / ${attempted} = ${((attempted ? stats.bounces / attempted : 0) * 100).toFixed(2)}%`,
          'Step hard bounce rate'
        )
      });
    }

    return stepAnalytics;
  }

  /**
   * Computes sender / mailbox performance analytics across configured email accounts.
   */
  public async getMailboxAnalytics(campaignId: string): Promise<MailboxSenderAnalytics[]> {
    const accounts = await EmailAccountModel.find({
      workspaceId: this.workspaceId,
      deletedAt: null
    }).lean();

    const deliveryAgg = await EmailDeliveryModel.aggregate([
      {
        $match: {
          workspaceId: this.workspaceId,
          campaignId,
          direction: 'OUTBOUND'
        }
      },
      {
        $group: {
          _id: '$accountId',
          attempted: { $sum: 1 },
          accepted: {
            $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, 1, 0] }
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] }
          },
          ambiguous: {
            $sum: { $cond: [{ $or: [{ $eq: ['$status', 'AMBIGUOUS'] }, { $eq: ['$ambiguous', true] }] }, 1, 0] }
          },
          bounces: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'FAILED'] },
                    {
                      $in: [
                        '$failureCategory',
                        ['INVALID_RECIPIENT', 'MAILBOX_UNAVAILABLE', 'DOMAIN_NOT_FOUND']
                      ]
                    }
                  ]
                },
                1,
                0
              ]
            }
          },
          replies: { $sum: '$replyCount' },
          observedOpens: { $sum: '$openCount' },
          observedClicks: { $sum: '$clickCount' },
          lastSentAt: { $max: '$sentAt' }
        }
      }
    ]);

    const statsMap = new Map<string, any>();
    for (const d of deliveryAgg) {
      statsMap.set(d._id, d);
    }

    const result: MailboxSenderAnalytics[] = [];

    for (const acc of accounts) {
      const stats = statsMap.get(acc._id.toString()) || {
        attempted: 0,
        accepted: 0,
        failed: 0,
        ambiguous: 0,
        bounces: 0,
        replies: 0,
        observedOpens: 0,
        observedClicks: 0,
        lastSentAt: null
      };

      const attempted = stats.attempted;
      const accepted = stats.accepted;

      result.push({
        accountId: acc._id.toString(),
        email: acc.email,
        name: acc.name || null,
        provider: acc.provider,
        status: acc.status,
        dailyLimit: acc.dailyLimit || 50,
        dailySent: acc.dailySent || 0,
        attempted,
        accepted,
        failed: stats.failed,
        ambiguous: stats.ambiguous,
        bounced: stats.bounces,
        replies: stats.replies,
        observedOpens: stats.observedOpens,
        observedClicks: stats.observedClicks,
        acceptanceRate: createMetricWithDenominator(
          accepted,
          attempted,
          `${accepted} / ${attempted} = ${((attempted ? accepted / attempted : 0) * 100).toFixed(2)}%`,
          'Mailbox send acceptance rate'
        ),
        lastSentAt: stats.lastSentAt ? new Date(stats.lastSentAt).toISOString() : null,
        rateLimited: (acc.status as string) === 'RATE_LIMITED' || (acc.dailySent >= (acc.dailyLimit || 50))
      });
    }

    return result;
  }

  /**
   * Computes audience deliverability quality breakdown correlating Phase 10 validation with campaign telemetry.
   */
  public async getQualityBreakdown(campaignId: string): Promise<AudienceQualityBreakdown> {
    const deliveries = await EmailDeliveryModel.find(
      {
        workspaceId: this.workspaceId,
        campaignId,
        direction: 'OUTBOUND'
      },
      { recipientEmail: 1, status: 1, hasReply: 1, failureCategory: 1 }
    ).lean();

    const emailQualityDocs = await EmailQualityModel.find({
      workspaceId: this.workspaceId
    }).lean();

    const qualityMap = new Map<string, EmailQualityStatus>();
    for (const eq of emailQualityDocs) {
      qualityMap.set(eq.email.toLowerCase(), eq.status);
    }

    const segments = new Map<EmailQualityStatus, { count: number; accepted: number; bounced: number; replied: number }>();
    for (const status of Object.values(EmailQualityStatus)) {
      segments.set(status, { count: 0, accepted: 0, bounced: 0, replied: 0 });
    }

    for (const d of deliveries) {
      const email = d.recipientEmail?.toLowerCase() || '';
      const quality = qualityMap.get(email) || EmailQualityStatus.UNKNOWN;
      const seg = segments.get(quality)!;
      seg.count++;
      if (d.status === 'SENT') seg.accepted++;
      if (d.status === 'FAILED' && ['INVALID_RECIPIENT', 'MAILBOX_UNAVAILABLE'].includes(d.failureCategory || '')) {
        seg.bounced++;
      }
      if (d.hasReply) seg.replied++;
    }

    const total = deliveries.length;
    const segmentList = Array.from(segments.entries())
      .filter(([_, data]) => data.count > 0)
      .map(([status, data]) => ({
        status,
        label: status.replace(/_/g, ' '),
        count: data.count,
        percentage: total ? Number(((data.count / total) * 100).toFixed(2)) : 0,
        accepted: data.accepted,
        bounced: data.bounced,
        replied: data.replied,
        bounceRate: data.count ? Number(((data.bounced / data.count) * 100).toFixed(2)) : 0
      }));

    return {
      totalEnrolled: total,
      segments: segmentList
    };
  }

  /**
   * Generates formatted campaign analytics export with full audit formulas and optional CSV content.
   */
  public async exportCampaign(
    campaignId: string,
    query: CampaignAnalyticsQuery = {},
    format: 'json' | 'csv' = 'json'
  ): Promise<CampaignAnalyticsExport> {
    const overview = await this.getOverview(campaignId, query);
    const steps = await this.getStepAnalytics(campaignId);
    const timelineResult = await this.getTimeline(campaignId, query);

    const metrics = [
      {
        metric: 'Contacts Enrolled',
        value: overview.counts.contactsEnrolled,
        numerator: overview.counts.contactsEnrolled,
        denominator: overview.counts.contactsEnrolled,
        formula: 'COUNT(DISTINCT contactId)',
        description: 'Total contacts enrolled in campaign'
      },
      {
        metric: 'Contacts Eligible',
        value: overview.counts.contactsEligible,
        numerator: overview.counts.contactsEligible,
        denominator: overview.counts.contactsEnrolled,
        formula: 'enrolled - suppressed',
        description: 'Contacts free from active suppression'
      },
      {
        metric: 'Emails Attempted',
        value: overview.counts.emailsAttempted,
        formula: 'status != QUEUED',
        description: 'Dispatched outbound messages'
      },
      {
        metric: 'Provider Accepted',
        value: overview.counts.emailsAccepted,
        formula: 'status == SENT',
        description: 'Accepted by mail provider queue'
      },
      {
        metric: 'Provider Acceptance Rate',
        value: overview.rates.providerAcceptanceRate.formatted,
        numerator: overview.rates.providerAcceptanceRate.numerator,
        denominator: overview.rates.providerAcceptanceRate.denominator,
        formula: overview.rates.providerAcceptanceRate.formula,
        description: overview.rates.providerAcceptanceRate.description
      },
      {
        metric: 'Unique Open Rate',
        value: overview.rates.uniqueOpenRate.formatted,
        numerator: overview.rates.uniqueOpenRate.numerator,
        denominator: overview.rates.uniqueOpenRate.denominator,
        formula: overview.rates.uniqueOpenRate.formula,
        description: overview.rates.uniqueOpenRate.description
      },
      {
        metric: 'Unique Click Rate',
        value: overview.rates.uniqueClickRate.formatted,
        numerator: overview.rates.uniqueClickRate.numerator,
        denominator: overview.rates.uniqueClickRate.denominator,
        formula: overview.rates.uniqueClickRate.formula,
        description: overview.rates.uniqueClickRate.description
      },
      {
        metric: 'Contact Reply Rate',
        value: overview.rates.contactReplyRate.formatted,
        numerator: overview.rates.contactReplyRate.numerator,
        denominator: overview.rates.contactReplyRate.denominator,
        formula: overview.rates.contactReplyRate.formula,
        description: overview.rates.contactReplyRate.description
      },
      {
        metric: 'Hard Bounce Rate',
        value: overview.rates.hardBounceRate.formatted,
        numerator: overview.rates.hardBounceRate.numerator,
        denominator: overview.rates.hardBounceRate.denominator,
        formula: overview.rates.hardBounceRate.formula,
        description: overview.rates.hardBounceRate.description
      }
    ];

    let csvContent: string | undefined = undefined;
    if (format === 'csv') {
      const lines = [
        `# LeadForge OS Campaign Analytics Export`,
        `# Campaign: ${overview.campaignName} (${overview.campaignId})`,
        `# Workspace: ${this.workspaceId}`,
        `# Timezone: ${overview.timezone}`,
        `# Exported At: ${new Date().toISOString()}`,
        `# Notice: Open tracking is labeled as observed due to mail client prefetching.`,
        ``,
        `Metric,Value,Numerator,Denominator,Formula,Description`,
        ...metrics.map(
          (m) =>
            `"${m.metric}","${m.value}","${m.numerator ?? ''}","${m.denominator ?? ''}","${m.formula ?? ''}","${m.description ?? ''}"`
        ),
        ``,
        `# Step Breakdown`,
        `StepIndex,StepName,Accepted,UniqueOpens,UniqueClicks,Replies,Bounces,ReplyRate`,
        ...steps.map(
          (s) =>
            `${s.stepIndex},"${s.stepName}",${s.accepted},${s.uniqueOpens},${s.uniqueClicks},${s.replies},${s.bounces},"${s.replyRate.formatted}"`
        )
      ];
      csvContent = lines.join('\n');
    }

    return {
      metadata: {
        campaignId,
        campaignName: overview.campaignName,
        workspaceId: this.workspaceId,
        exportedAt: new Date().toISOString(),
        timezone: overview.timezone,
        timeRange: overview.timeRange
      },
      metrics,
      steps,
      timeline: timelineResult.points,
      csvContent
    };
  }

  /**
   * Performs comparative multi-campaign evaluation.
   */
  public static async compareCampaigns(
    workspaceId: string,
    campaignIds: string[],
    query: CampaignAnalyticsQuery = {}
  ): Promise<CampaignComparisonResult> {
    const service = new CampaignAnalyticsService(workspaceId);
    const comparisonItems = [];

    for (const cid of campaignIds) {
      try {
        const ov = await service.getOverview(cid, query);
        comparisonItems.push({
          campaignId: cid,
          campaignName: ov.campaignName,
          status: ov.status,
          enrolled: ov.counts.contactsEnrolled,
          accepted: ov.counts.emailsAccepted,
          uniqueOpens: ov.counts.uniqueOpenedDeliveries,
          uniqueOpenRate: ov.rates.uniqueOpenRate.value,
          replies: ov.counts.replyingContacts,
          replyRate: ov.rates.contactReplyRate.value,
          bounces: ov.counts.hardBounces,
          bounceRate: ov.rates.hardBounceRate.value,
          medianReplyHours: ov.latency.medianHours
        });
      } catch {
        // Skip invalid or deleted campaign in comparison
      }
    }

    return {
      campaigns: comparisonItems,
      comparedAt: new Date().toISOString(),
      notes: [
        'All rates use explicit denominators: open rate is based on accepted emails, reply rate is based on eligible contacts.',
        'Beware comparing campaigns with vastly different enrollment sample sizes or different sequence step counts.'
      ]
    };
  }
}
