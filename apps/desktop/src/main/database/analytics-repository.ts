import Database from 'better-sqlite3';
import type {
  CampaignAnalyticsOverview,
  CampaignTimelinePoint,
  SequenceStepAnalytics,
  MailboxSenderAnalytics,
  AudienceQualityBreakdown,
  CampaignComparisonResult,
  CampaignAnalyticsExport,
  CampaignAnalyticsQuery,
  CampaignFunnelStage
} from '@huntara/schema';
import {
  createMetricWithDenominator,
  EmailQualityStatus
} from '@huntara/schema';

export class DesktopAnalyticsRepository {
  constructor(private readonly db: Database.Database) {}

  private isDsnBounceRecord(d: any): boolean {
    if (
      d.sequenceId === 'inbound-dsn' ||
      d.executionId === 'inbound-dsn' ||
      d.contactId === 'bounce-subsystem'
    ) {
      return true;
    }
    const sender = (d.senderEmail || '').toLowerCase();
    if (
      sender.includes('mailer-daemon') ||
      sender.includes('postmaster') ||
      sender.includes('mail delivery subsystem')
    ) {
      return true;
    }
    const subject = (d.subject || '').toLowerCase();
    if (
      subject.includes('delivery status notification') ||
      subject.includes('failure notice') ||
      subject.includes('undelivered mail') ||
      subject.includes('mail delivery failed')
    ) {
      return true;
    }
    return false;
  }

  public getOverview(
    workspaceId: string,
    campaignId: string,
    query?: CampaignAnalyticsQuery
  ): CampaignAnalyticsOverview {
    // 1. Fetch Campaign Details
    const campaign = this.db
      .prepare('SELECT * FROM campaigns WHERE id = ? AND workspaceId = ?')
      .get(campaignId, workspaceId) as any;

    const campaignName = campaign?.name || `Campaign ${campaignId}`;
    const status = campaign?.status || 'UNKNOWN';
    const timezone = query?.timezone || campaign?.timezone || 'UTC';

    // 2. Fetch Sequence Executions (Enrollments)
    const executions = this.db
      .prepare('SELECT * FROM sequence_executions WHERE campaignId = ? AND workspaceId = ?')
      .all(campaignId, workspaceId) as any[];

    const enrolledContactIds = new Set<string>();
    let contactsActive = 0;
    let contactsCompleted = 0;
    let contactsFailed = 0;
    let sequencesCompleted = 0;
    let sequencesStoppedByReply = 0;
    let sequencesCancelled = 0;

    for (const exec of executions) {
      if (exec.contactId) {
        enrolledContactIds.add(exec.contactId);
      }
      const st = (exec.status || '').toUpperCase();
      if (['RUNNING', 'PENDING', 'ACTIVE'].includes(st)) {
        contactsActive++;
      } else if (st === 'COMPLETED') {
        contactsCompleted++;
        sequencesCompleted++;
      } else if (st === 'FAILED') {
        contactsFailed++;
      } else if (['CANCELLED', 'STOPPED'].includes(st)) {
        sequencesCancelled++;
      }
      if (exec.replies > 0 || st === 'REPLIED') {
        sequencesStoppedByReply++;
      }
    }

    const contactsEnrolled = enrolledContactIds.size;

    // 3. Fetch Deliveries with filters
    let deliveryQuery = `SELECT * FROM email_deliveries WHERE campaignId = ? AND workspaceId = ?`;
    const params: any[] = [campaignId, workspaceId];

    if (query?.startDate) {
      deliveryQuery += ` AND sentAt >= ?`;
      params.push(query.startDate);
    }
    if (query?.endDate) {
      deliveryQuery += ` AND sentAt <= ?`;
      params.push(query.endDate);
    }
    if (query?.stepIndex !== undefined) {
      deliveryQuery += ` AND stepIndex = ?`;
      params.push(query.stepIndex);
    }
    if (query?.accountId) {
      deliveryQuery += ` AND accountId = ?`;
      params.push(query.accountId);
    }

    const deliveries = this.db.prepare(deliveryQuery).all(...params) as any[];

    let emailsAttempted = 0;
    let emailsAccepted = 0;
    let emailsFailed = 0;
    let emailsAmbiguous = 0;
    let hardBounces = 0;
    let observedOpens = 0;
    let observedClicks = 0;
    let repliesReceived = 0;

    const uniqueOpenedDeliveriesSet = new Set<string>();
    const uniqueOpenedContactsSet = new Set<string>();
    const uniqueClickedDeliveriesSet = new Set<string>();
    const uniqueClickedContactsSet = new Set<string>();
    const replyingContactsSet = new Set<string>();

    const replyLatenciesHours: number[] = [];

    let directThreadAttribution = 0;
    let directHeaderAttribution = 0;
    let contactMatchAttribution = 0;

    for (const d of deliveries) {
      const dir = (d.direction || 'OUTBOUND').toUpperCase();
      if (dir === 'OUTBOUND') {
        emailsAttempted++;

        const dStatus = (d.status || '').toUpperCase();
        if (['SENT', 'ACCEPTED', 'DELIVERED'].includes(dStatus)) {
          emailsAccepted++;
        } else if (['FAILED', 'REJECTED'].includes(dStatus)) {
          emailsFailed++;
        } else if (dStatus === 'BOUNCED') {
          hardBounces++;
        }

        if (d.ambiguous) {
          emailsAmbiguous++;
        }

        const opens = Number(d.openCount || 0);
        if (opens > 0) {
          observedOpens += opens;
          uniqueOpenedDeliveriesSet.add(d.id);
          if (d.contactId) uniqueOpenedContactsSet.add(d.contactId);
        }

        const clicks = Number(d.clickCount || 0);
        if (clicks > 0) {
          observedClicks += clicks;
          uniqueClickedDeliveriesSet.add(d.id);
          if (d.contactId) uniqueClickedContactsSet.add(d.contactId);
        }

        const repCount = Number(d.replyCount || 0);
        if (d.hasReply || repCount > 0) {
          repliesReceived += Math.max(repCount, 1);
          if (d.contactId) replyingContactsSet.add(d.contactId);

          if (d.providerThreadId) {
            directThreadAttribution++;
          } else if (d.providerMessageId) {
            directHeaderAttribution++;
          } else {
            contactMatchAttribution++;
          }

          if (d.sentAt && d.lastRepliedAt) {
            const sentMs = new Date(d.sentAt).getTime();
            const repMs = new Date(d.lastRepliedAt).getTime();
            if (repMs >= sentMs) {
              replyLatenciesHours.push((repMs - sentMs) / (1000 * 3600));
            }
          }
        }
      } else if (dir === 'INBOUND') {
        if (this.isDsnBounceRecord(d)) {
          hardBounces++;
        } else {
          repliesReceived++;
          if (d.contactId && d.contactId !== 'unmatched-contact') {
            replyingContactsSet.add(d.contactId);
          }
        }
      }
    }

    // 4. Suppressions count for enrolled contacts
    let contactsSuppressed = 0;
    if (enrolledContactIds.size > 0) {
      const contactEmails = this.db
        .prepare(
          `SELECT email FROM contacts WHERE id IN (${Array.from(enrolledContactIds).map(() => '?').join(',')})`
        )
        .all(...Array.from(enrolledContactIds)) as { email: string }[];

      if (contactEmails.length > 0) {
        const suppressionCheck = this.db
          .prepare(
            `SELECT COUNT(DISTINCT email) as count FROM suppressions WHERE workspaceId = ? AND email IN (${contactEmails.map(() => '?').join(',')})`
          )
          .get(workspaceId, ...contactEmails.map(c => c.email.toLowerCase().trim())) as any;
        contactsSuppressed = suppressionCheck?.count || 0;
      }
    }

    const contactsEligible = Math.max(0, contactsEnrolled - contactsSuppressed);
    const uniqueOpenedDeliveries = uniqueOpenedDeliveriesSet.size;
    const uniqueOpenedContacts = uniqueOpenedContactsSet.size;
    const uniqueClickedDeliveries = uniqueClickedDeliveriesSet.size;
    const uniqueClickedContacts = uniqueClickedContactsSet.size;
    const replyingContacts = replyingContactsSet.size;

    // 5. Latency Stats
    let minHours = 0;
    let averageHours = 0;
    let medianHours = 0;
    let p90Hours = 0;

    if (replyLatenciesHours.length > 0) {
      replyLatenciesHours.sort((a, b) => a - b);
      minHours = Number((replyLatenciesHours[0] ?? 0).toFixed(2));
      const totalHours = replyLatenciesHours.reduce((acc, h) => acc + h, 0);
      averageHours = Number((totalHours / replyLatenciesHours.length).toFixed(2));

      const mid = Math.floor(replyLatenciesHours.length / 2);
      medianHours =
        replyLatenciesHours.length % 2 !== 0
          ? Number((replyLatenciesHours[mid] ?? 0).toFixed(2))
          : Number((((replyLatenciesHours[mid - 1] ?? 0) + (replyLatenciesHours[mid] ?? 0)) / 2).toFixed(2));

      const p90Idx = Math.floor(replyLatenciesHours.length * 0.9);
      p90Hours = Number((replyLatenciesHours[p90Idx] ?? 0).toFixed(2));
    }

    // 6. Rates using authoritative createMetricWithDenominator
    const rates = {
      contactReplyRate: createMetricWithDenominator(
        replyingContacts,
        contactsEligible > 0 ? contactsEligible : contactsEnrolled,
        'replyingContacts / contactsEligible',
        'Unique contacts that replied divided by eligible outreach contacts',
        'percent',
        'Relies on threading or email match attribution; out-of-office replies may be counted if unclassified'
      ),
      messageReplyRate: createMetricWithDenominator(
        repliesReceived,
        emailsAccepted,
        'repliesReceived / emailsAccepted',
        'Total reply messages received divided by provider-accepted outbound messages',
        'percent'
      ),
      observedOpenRate: createMetricWithDenominator(
        observedOpens,
        emailsAccepted,
        'observedOpens / emailsAccepted',
        'Total observed tracking pixel events divided by provider accepted emails',
        'percent',
        'Proxy caching, image blocking, and Apple Mail Privacy Protection affect pixel accuracy'
      ),
      uniqueOpenRate: createMetricWithDenominator(
        uniqueOpenedContacts,
        emailsAccepted,
        'uniqueOpenedContacts / emailsAccepted',
        'Unique recipients who registered at least one open event divided by provider accepted emails',
        'percent'
      ),
      observedClickRate: createMetricWithDenominator(
        observedClicks,
        emailsAccepted,
        'observedClicks / emailsAccepted',
        'Total observed link redirect events divided by provider accepted emails',
        'percent',
        'Security scanners and anti-phishing bots may pre-fetch links, causing click inflation'
      ),
      uniqueClickRate: createMetricWithDenominator(
        uniqueClickedContacts,
        emailsAccepted,
        'uniqueClickedContacts / emailsAccepted',
        'Unique contacts who clicked at least one link divided by provider accepted emails',
        'percent'
      ),
      clickToOpenRate: createMetricWithDenominator(
        uniqueClickedContacts,
        uniqueOpenedContacts,
        'uniqueClickedContacts / uniqueOpenedContacts',
        'Unique clicking contacts divided by unique opening contacts',
        'percent'
      ),
      providerAcceptanceRate: createMetricWithDenominator(
        emailsAccepted,
        emailsAttempted,
        'emailsAccepted / emailsAttempted',
        'Emails acknowledged by sending provider SMTP/API divided by attempted dispatches',
        'percent',
        'Provider acceptance does not guarantee delivery to recipient primary inbox folder'
      ),
      hardBounceRate: createMetricWithDenominator(
        hardBounces,
        emailsAttempted,
        'hardBounces / emailsAttempted',
        'Permanent bounce errors reported by destination MTA divided by attempted dispatches',
        'percent'
      ),
      suppressionRate: createMetricWithDenominator(
        contactsSuppressed,
        contactsEnrolled,
        'contactsSuppressed / contactsEnrolled',
        'Enrolled contacts suppressed by pre-flight checks divided by total enrolled contacts',
        'percent'
      )
    };

    // 7. Funnel
    const funnel: CampaignFunnelStage[] = [
      {
        stage: 'enrolled',
        label: 'Contacts Enrolled',
        count: contactsEnrolled,
        conversionRate: 1.0,
        formattedConversionRate: '100.00%',
        dropoffCount: contactsSuppressed,
        dropoffRate: contactsEnrolled > 0 ? contactsSuppressed / contactsEnrolled : 0,
        denominator: contactsEnrolled,
        formula: 'enrolled / enrolled',
        isTerminal: false,
        note: 'Total unique contacts targeted by this campaign'
      },
      {
        stage: 'accepted',
        label: 'Provider Accepted',
        count: emailsAccepted,
        conversionRate: contactsEnrolled > 0 ? emailsAccepted / contactsEnrolled : 0,
        formattedConversionRate: `${(contactsEnrolled > 0 ? (emailsAccepted / contactsEnrolled) * 100 : 0).toFixed(2)}%`,
        dropoffCount: Math.max(0, emailsAttempted - emailsAccepted),
        dropoffRate: emailsAttempted > 0 ? (emailsAttempted - emailsAccepted) / emailsAttempted : 0,
        denominator: contactsEnrolled,
        formula: 'emailsAccepted / contactsEnrolled',
        isTerminal: false,
        note: 'Emails accepted by SMTP/provider relay (not guaranteed inbox delivery)'
      },
      {
        stage: 'opened',
        label: 'Observed Opens',
        count: uniqueOpenedContacts,
        conversionRate: emailsAccepted > 0 ? uniqueOpenedContacts / emailsAccepted : 0,
        formattedConversionRate: `${(emailsAccepted > 0 ? (uniqueOpenedContacts / emailsAccepted) * 100 : 0).toFixed(2)}%`,
        dropoffCount: Math.max(0, emailsAccepted - uniqueOpenedContacts),
        dropoffRate: emailsAccepted > 0 ? (emailsAccepted - uniqueOpenedContacts) / emailsAccepted : 0,
        denominator: emailsAccepted,
        formula: 'uniqueOpenedContacts / emailsAccepted',
        isTerminal: false,
        note: 'Recipients with at least one observed tracking pixel request'
      },
      {
        stage: 'clicked',
        label: 'Observed Clicks',
        count: uniqueClickedContacts,
        conversionRate: uniqueOpenedContacts > 0 ? uniqueClickedContacts / uniqueOpenedContacts : 0,
        formattedConversionRate: `${(uniqueOpenedContacts > 0 ? (uniqueClickedContacts / uniqueOpenedContacts) * 100 : 0).toFixed(2)}%`,
        dropoffCount: Math.max(0, uniqueOpenedContacts - uniqueClickedContacts),
        dropoffRate: uniqueOpenedContacts > 0 ? (uniqueOpenedContacts - uniqueClickedContacts) / uniqueOpenedContacts : 0,
        denominator: uniqueOpenedContacts,
        formula: 'uniqueClickedContacts / uniqueOpenedContacts',
        isTerminal: false,
        note: 'Recipients who clicked at least one link redirect'
      },
      {
        stage: 'replied',
        label: 'Inbound Replies',
        count: replyingContacts,
        conversionRate: contactsEnrolled > 0 ? replyingContacts / contactsEnrolled : 0,
        formattedConversionRate: `${(contactsEnrolled > 0 ? (replyingContacts / contactsEnrolled) * 100 : 0).toFixed(2)}%`,
        dropoffCount: Math.max(0, contactsEnrolled - replyingContacts),
        dropoffRate: contactsEnrolled > 0 ? (contactsEnrolled - replyingContacts) / contactsEnrolled : 0,
        denominator: contactsEnrolled,
        formula: 'replyingContacts / contactsEnrolled',
        isTerminal: true,
        note: 'Attributed inbound responses from target contacts'
      }
    ];

    return {
      campaignId,
      campaignName,
      status,
      timezone,
      timeRange: {
        startDate: query?.startDate || null,
        endDate: query?.endDate || null
      },
      counts: {
        contactsEnrolled,
        contactsEligible,
        contactsSuppressed,
        emailsScheduled: emailsAttempted,
        emailsQueued: 0,
        emailsAttempted,
        emailsAccepted,
        emailsFailed,
        emailsAmbiguous,
        observedOpens,
        uniqueOpenedDeliveries,
        uniqueOpenedContacts,
        observedClicks,
        uniqueClickedDeliveries,
        uniqueClickedContacts,
        repliesReceived,
        replyingContacts,
        hardBounces,
        softBounces: 0,
        sequencesStoppedByReply,
        sequencesCompleted,
        sequencesCancelled
      },
      rates,
      funnel,
      latency: {
        minHours,
        medianHours,
        averageHours,
        p90Hours,
        totalRepliesCalculated: replyLatenciesHours.length,
        sampleSizeNote:
          replyLatenciesHours.length < 5
            ? 'Small sample size (< 5 replies). Median and percentiles may not be statistically significant.'
            : `${replyLatenciesHours.length} reply intervals calculated.`
      },
      attributionConfidence: {
        directThread: directThreadAttribution,
        directHeader: directHeaderAttribution,
        contactMatch: contactMatchAttribution
      },
      computedAt: new Date().toISOString()
    };
  }

  public getTimeline(
    workspaceId: string,
    campaignId: string,
    query?: CampaignAnalyticsQuery
  ): { points: CampaignTimelinePoint[]; timezone: string } {
    const campaign = this.db
      .prepare('SELECT timezone FROM campaigns WHERE id = ? AND workspaceId = ?')
      .get(campaignId, workspaceId) as any;

    const timezone = query?.timezone || campaign?.timezone || 'UTC';

    let sql = `SELECT * FROM email_deliveries WHERE campaignId = ? AND workspaceId = ? AND sentAt IS NOT NULL`;
    const params: any[] = [campaignId, workspaceId];

    if (query?.startDate) {
      sql += ` AND sentAt >= ?`;
      params.push(query.startDate);
    }
    if (query?.endDate) {
      sql += ` AND sentAt <= ?`;
      params.push(query.endDate);
    }

    const deliveries = this.db.prepare(sql).all(...params) as any[];

    // Group by Date using Intl.DateTimeFormat for guaranteed timezone accuracy
    const dateGroups = new Map<string, CampaignTimelinePoint>();

    const getLocalDateKey = (dateStr: string): string => {
      try {
        const d = new Date(dateStr);
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        return formatter.format(d); // Returns YYYY-MM-DD
      } catch {
        return dateStr.slice(0, 10);
      }
    };

    for (const d of deliveries) {
      const dateKey = getLocalDateKey(d.sentAt);
      let point = dateGroups.get(dateKey);
      if (!point) {
        point = {
          timestamp: `${dateKey}T00:00:00.000Z`,
          label: dateKey,
          attempted: 0,
          accepted: 0,
          observedOpens: 0,
          observedClicks: 0,
          replies: 0,
          bounces: 0,
          failures: 0
        };
        dateGroups.set(dateKey, point);
      }

      const dir = (d.direction || 'OUTBOUND').toUpperCase();
      if (dir === 'OUTBOUND') {
        point.attempted++;
        const st = (d.status || '').toUpperCase();
        if (['SENT', 'ACCEPTED', 'DELIVERED'].includes(st)) {
          point.accepted++;
        } else if (['FAILED', 'REJECTED'].includes(st)) {
          point.failures++;
        } else if (st === 'BOUNCED') {
          point.bounces++;
        }

        point.observedOpens += Number(d.openCount || 0);
        point.observedClicks += Number(d.clickCount || 0);
        point.replies += Number(d.replyCount || 0) + (d.hasReply ? 1 : 0);
      } else if (dir === 'INBOUND') {
        if (this.isDsnBounceRecord(d)) {
          point.bounces++;
        } else {
          point.replies++;
        }
      }
    }

    const points = Array.from(dateGroups.values()).sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    );

    return { points, timezone };
  }

  public getSteps(
    workspaceId: string,
    campaignId: string
  ): { steps: SequenceStepAnalytics[] } {
    // 1. Fetch sequence steps if sequenceId is present
    const campaign = this.db
      .prepare('SELECT sequenceId FROM campaigns WHERE id = ? AND workspaceId = ?')
      .get(campaignId, workspaceId) as any;

    let sequenceStepsDef: any[] = [];
    if (campaign?.sequenceId) {
      const seq = this.db
        .prepare('SELECT steps FROM sequences WHERE id = ? AND workspaceId = ?')
        .get(campaign.sequenceId, workspaceId) as any;
      if (seq?.steps) {
        try {
          sequenceStepsDef = typeof seq.steps === 'string' ? JSON.parse(seq.steps) : seq.steps;
        } catch {}
      }
    }

    // 2. Fetch executions and deliveries grouped by stepIndex
    const executions = this.db
      .prepare('SELECT * FROM sequence_executions WHERE campaignId = ? AND workspaceId = ?')
      .all(campaignId, workspaceId) as any[];

    const deliveries = this.db
      .prepare('SELECT * FROM email_deliveries WHERE campaignId = ? AND workspaceId = ?')
      .all(campaignId, workspaceId) as any[];

    // Group deliveries by stepIndex
    const stepIndices = new Set<number>();
    sequenceStepsDef.forEach((_, idx) => stepIndices.add(idx));
    deliveries.forEach(d => {
      if (d.stepIndex !== undefined && d.stepIndex !== null) {
        stepIndices.add(Number(d.stepIndex));
      }
    });

    const sortedStepIndices = Array.from(stepIndices).sort((a, b) => a - b);
    const resultSteps: SequenceStepAnalytics[] = [];

    for (const sIdx of sortedStepIndices) {
      const stepDef = sequenceStepsDef[sIdx] || {};
      const stepName = stepDef.name || `Step ${sIdx + 1}`;
      const stepType = stepDef.type || 'email';
      const delayDays = stepDef.delayDays || 0;
      const templateId = stepDef.templateId || null;
      const templateSubject = stepDef.subject || null;

      const stepDeliveries = deliveries.filter(
        d => Number(d.stepIndex || 0) === sIdx && (d.direction || 'OUTBOUND').toUpperCase() === 'OUTBOUND'
      );

      const contactsEntered = executions.filter(e => Number(e.currentStep || 0) >= sIdx).length;
      const eligible = contactsEntered;
      let accepted = 0;
      let failed = 0;
      let bounces = 0;
      let observedOpens = 0;
      let observedClicks = 0;
      let replies = 0;
      let stopped = 0;

      const uniqueOpensSet = new Set<string>();
      const uniqueClicksSet = new Set<string>();

      for (const d of stepDeliveries) {
        const st = (d.status || '').toUpperCase();
        if (['SENT', 'ACCEPTED', 'DELIVERED'].includes(st)) {
          accepted++;
        } else if (['FAILED', 'REJECTED'].includes(st)) {
          failed++;
        } else if (st === 'BOUNCED') {
          bounces++;
        }

        const op = Number(d.openCount || 0);
        if (op > 0) {
          observedOpens += op;
          if (d.contactId) uniqueOpensSet.add(d.contactId);
        }

        const cl = Number(d.clickCount || 0);
        if (cl > 0) {
          observedClicks += cl;
          if (d.contactId) uniqueClicksSet.add(d.contactId);
        }

        const rep = Number(d.replyCount || 0) + (d.hasReply ? 1 : 0);
        if (rep > 0) {
          replies += rep;
          stopped++;
        }
      }

      resultSteps.push({
        stepIndex: sIdx,
        stepName,
        stepType,
        delayDays,
        templateId,
        templateSubject,
        contactsEntered,
        eligible,
        accepted,
        failed,
        observedOpens,
        uniqueOpens: uniqueOpensSet.size,
        observedClicks,
        uniqueClicks: uniqueClicksSet.size,
        replies,
        bounces,
        stopped,
        acceptanceRate: createMetricWithDenominator(
          accepted,
          stepDeliveries.length,
          'accepted / stepDispatches',
          'Provider accepted dispatches for this sequence step',
          'percent'
        ),
        openRate: createMetricWithDenominator(
          uniqueOpensSet.size,
          accepted,
          'uniqueOpens / accepted',
          'Unique contacts who opened this step email',
          'percent'
        ),
        replyRate: createMetricWithDenominator(
          replies,
          accepted,
          'replies / accepted',
          'Inbound replies generated from this specific step',
          'percent'
        ),
        bounceRate: createMetricWithDenominator(
          bounces,
          stepDeliveries.length,
          'bounces / stepDispatches',
          'Hard bounces encountered on this step',
          'percent'
        )
      });
    }

    return { steps: resultSteps };
  }

  public getMailboxes(
    workspaceId: string,
    campaignId: string
  ): { mailboxes: MailboxSenderAnalytics[] } {
    const deliveries = this.db
      .prepare(
        `SELECT * FROM email_deliveries WHERE campaignId = ? AND workspaceId = ? AND direction = 'OUTBOUND'`
      )
      .all(campaignId, workspaceId) as any[];

    // Fetch accounts in workspace
    const accounts = this.db
      .prepare('SELECT * FROM email_accounts WHERE workspaceId = ?')
      .all(workspaceId) as any[];

    const accountMap = new Map<string, any>();
    accounts.forEach(acc => accountMap.set(acc.id, acc));

    const mailboxDeliveries = new Map<string, any[]>();
    for (const d of deliveries) {
      const accId = d.accountId || 'unassigned';
      if (!mailboxDeliveries.has(accId)) {
        mailboxDeliveries.set(accId, []);
      }
      mailboxDeliveries.get(accId)!.push(d);
    }

    const result: MailboxSenderAnalytics[] = [];

    for (const [accId, dels] of mailboxDeliveries.entries()) {
      const acc = accountMap.get(accId);
      const email = acc?.email || dels[0]?.senderEmail || 'unknown@example.com';
      const name = acc?.displayName || acc?.name || null;
      const provider = acc?.provider || 'smtp';
      const status = acc?.status || 'ACTIVE';
      const dailyLimit = Number(acc?.dailyLimit || 50);
      const dailySent = Number(acc?.dailySent || 0);

      let attempted = 0;
      let accepted = 0;
      let failed = 0;
      let ambiguous = 0;
      let bounced = 0;
      let replies = 0;
      let observedOpens = 0;
      let observedClicks = 0;
      let lastSentAt: string | null = null;

      for (const d of dels) {
        attempted++;
        const st = (d.status || '').toUpperCase();
        if (['SENT', 'ACCEPTED', 'DELIVERED'].includes(st)) {
          accepted++;
        } else if (['FAILED', 'REJECTED'].includes(st)) {
          failed++;
        } else if (st === 'BOUNCED') {
          bounced++;
        }

        if (d.ambiguous) ambiguous++;
        observedOpens += Number(d.openCount || 0);
        observedClicks += Number(d.clickCount || 0);
        replies += Number(d.replyCount || 0) + (d.hasReply ? 1 : 0);

        if (d.sentAt && (!lastSentAt || d.sentAt > lastSentAt)) {
          lastSentAt = d.sentAt;
        }
      }

      result.push({
        accountId: accId,
        email,
        name,
        provider,
        status,
        dailyLimit,
        dailySent,
        attempted,
        accepted,
        failed,
        ambiguous,
        bounced,
        replies,
        observedOpens,
        observedClicks,
        acceptanceRate: createMetricWithDenominator(
          accepted,
          attempted,
          'accepted / attempted',
          'Mailbox provider acceptance rate',
          'percent'
        ),
        lastSentAt,
        cooldownRemainingSec: null,
        rateLimited: dailySent >= dailyLimit
      });
    }

    return { mailboxes: result };
  }

  public getQuality(
    workspaceId: string,
    campaignId: string
  ): AudienceQualityBreakdown {
    const executions = this.db
      .prepare('SELECT contactId FROM sequence_executions WHERE campaignId = ? AND workspaceId = ?')
      .all(campaignId, workspaceId) as any[];

    const contactIds = Array.from(new Set(executions.map(e => e.contactId).filter(Boolean)));
    const totalEnrolled = contactIds.length;

    if (totalEnrolled === 0) {
      return { totalEnrolled: 0, segments: [] };
    }

    // Retrieve contacts
    const contacts = this.db
      .prepare(
        `SELECT id, email, emailStatus, emailQuality FROM contacts WHERE id IN (${contactIds.map(() => '?').join(',')})`
      )
      .all(...contactIds) as any[];

    // Also check email_quality table
    const qualityRecords = this.db
      .prepare(`SELECT email, status FROM email_quality WHERE workspaceId = ?`)
      .all(workspaceId) as any[];
    const qualityMap = new Map<string, string>();
    qualityRecords.forEach(q => qualityMap.set(q.email.toLowerCase().trim(), q.status));

    // Deliveries by contact
    const deliveries = this.db
      .prepare(
        `SELECT contactId, status, replyCount, hasReply FROM email_deliveries WHERE campaignId = ? AND workspaceId = ? AND direction = 'OUTBOUND'`
      )
      .all(campaignId, workspaceId) as any[];

    const contactStats = new Map<string, { accepted: number; bounced: number; replied: number }>();
    for (const d of deliveries) {
      if (!d.contactId) continue;
      let stat = contactStats.get(d.contactId);
      if (!stat) {
        stat = { accepted: 0, bounced: 0, replied: 0 };
        contactStats.set(d.contactId, stat);
      }
      const st = (d.status || '').toUpperCase();
      if (['SENT', 'ACCEPTED', 'DELIVERED'].includes(st)) stat.accepted++;
      if (st === 'BOUNCED') stat.bounced++;
      if (d.hasReply || Number(d.replyCount || 0) > 0) stat.replied++;
    }

    const segmentsMap = new Map<
      EmailQualityStatus,
      { count: number; accepted: number; bounced: number; replied: number }
    >();

    for (const c of contacts) {
      const cleanEmail = (c.email || '').toLowerCase().trim();
      let status: EmailQualityStatus = EmailQualityStatus.UNKNOWN;

      if (qualityMap.has(cleanEmail)) {
        status = qualityMap.get(cleanEmail) as EmailQualityStatus;
      } else if (c.emailQuality) {
        try {
          const parsed = typeof c.emailQuality === 'string' ? JSON.parse(c.emailQuality) : c.emailQuality;
          status = (parsed.status as EmailQualityStatus) || EmailQualityStatus.UNKNOWN;
        } catch {
          status = EmailQualityStatus.UNKNOWN;
        }
      } else if (c.emailStatus === 'verified') {
        status = EmailQualityStatus.VERIFIED;
      }

      if (!segmentsMap.has(status)) {
        segmentsMap.set(status, { count: 0, accepted: 0, bounced: 0, replied: 0 });
      }
      const seg = segmentsMap.get(status)!;
      seg.count++;

      const stats = contactStats.get(c.id);
      if (stats) {
        seg.accepted += stats.accepted;
        seg.bounced += stats.bounced;
        seg.replied += stats.replied;
      }
    }

    const segments = Array.from(segmentsMap.entries()).map(([status, seg]) => {
      const percentage = totalEnrolled > 0 ? (seg.count / totalEnrolled) * 100 : 0;
      const bounceRate = seg.accepted + seg.bounced > 0 ? (seg.bounced / (seg.accepted + seg.bounced)) * 100 : 0;
      return {
        status,
        label: status.replace(/_/g, ' '),
        count: seg.count,
        percentage: Number(percentage.toFixed(1)),
        accepted: seg.accepted,
        bounced: seg.bounced,
        replied: seg.replied,
        bounceRate: Number(bounceRate.toFixed(2))
      };
    });

    return { totalEnrolled, segments };
  }

  public compare(
    workspaceId: string,
    campaignIds: string[],
    query?: CampaignAnalyticsQuery
  ): CampaignComparisonResult {
    const campaigns = campaignIds.map(cId => {
      const overview = this.getOverview(workspaceId, cId, query);
      return {
        campaignId: overview.campaignId,
        campaignName: overview.campaignName,
        status: overview.status,
        enrolled: overview.counts.contactsEnrolled,
        accepted: overview.counts.emailsAccepted,
        uniqueOpens: overview.counts.uniqueOpenedContacts,
        uniqueOpenRate: overview.rates.uniqueOpenRate.value,
        replies: overview.counts.replyingContacts,
        replyRate: overview.rates.contactReplyRate.value,
        bounces: overview.counts.hardBounces,
        bounceRate: overview.rates.hardBounceRate.value,
        medianReplyHours: overview.latency.medianHours
      };
    });

    return {
      campaigns,
      comparedAt: new Date().toISOString(),
      notes: [
        'Comparisons standardize rates across distinct contact denominators.',
        'Open tracking differences may reflect varied mailbox providers across target audiences.'
      ]
    };
  }

  public export(
    workspaceId: string,
    campaignId: string,
    format: 'json' | 'csv' = 'json',
    query?: CampaignAnalyticsQuery
  ): CampaignAnalyticsExport {
    const overview = this.getOverview(workspaceId, campaignId, query);
    const { steps } = this.getSteps(workspaceId, campaignId);
    const { points: timeline } = this.getTimeline(workspaceId, campaignId, query);

    const metrics = [
      {
        metric: 'Contacts Enrolled',
        value: overview.counts.contactsEnrolled,
        numerator: overview.counts.contactsEnrolled,
        denominator: overview.counts.contactsEnrolled,
        formula: 'enrolled',
        description: 'Total contacts enrolled in campaign'
      },
      {
        metric: 'Emails Accepted',
        value: overview.counts.emailsAccepted,
        numerator: overview.rates.providerAcceptanceRate.numerator,
        denominator: overview.rates.providerAcceptanceRate.denominator,
        formula: overview.rates.providerAcceptanceRate.formula,
        description: overview.rates.providerAcceptanceRate.description
      },
      {
        metric: 'Observed Open Rate',
        value: overview.rates.observedOpenRate.formatted,
        numerator: overview.rates.observedOpenRate.numerator,
        denominator: overview.rates.observedOpenRate.denominator,
        formula: overview.rates.observedOpenRate.formula,
        description: overview.rates.observedOpenRate.description
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
      },
      {
        metric: 'Median Reply Latency (Hours)',
        value: overview.latency.medianHours,
        numerator: null,
        denominator: null,
        formula: 'median(lastRepliedAt - sentAt)',
        description: overview.latency.sampleSizeNote
      }
    ];

    let csvContent: string | undefined;

    if (format === 'csv') {
      const lines = [
        '# HUNTARA Campaign Performance Export',
        `# Campaign: ${overview.campaignName} (${campaignId})`,
        `# Exported At: ${overview.computedAt}`,
        `# Timezone: ${overview.timezone}`,
        '',
        'Section,Metric,Value,Numerator,Denominator,Formula,Description'
      ];

      for (const m of metrics) {
        lines.push(
          `"Overview","${m.metric}","${m.value}","${m.numerator ?? ''}","${m.denominator ?? ''}","${m.formula ?? ''}","${m.description ?? ''}"`
        );
      }

      lines.push('');
      lines.push('Section,Step Index,Step Name,Step Type,Accepted,Unique Opens,Replies,Bounces');
      for (const s of steps) {
        lines.push(
          `"Steps",${s.stepIndex},"${s.stepName}","${s.stepType}",${s.accepted},${s.uniqueOpens},${s.replies},${s.bounces}`
        );
      }

      lines.push('');
      lines.push('Section,Date,Attempted,Accepted,Observed Opens,Observed Clicks,Replies,Bounces');
      for (const t of timeline) {
        lines.push(
          `"Timeline","${t.label}",${t.attempted},${t.accepted},${t.observedOpens},${t.observedClicks},${t.replies},${t.bounces}`
        );
      }

      csvContent = lines.join('\n');
    }

    return {
      metadata: {
        campaignId,
        campaignName: overview.campaignName,
        workspaceId,
        exportedAt: overview.computedAt,
        timezone: overview.timezone,
        timeRange: overview.timeRange
      },
      metrics,
      steps,
      timeline,
      csvContent
    };
  }
}
