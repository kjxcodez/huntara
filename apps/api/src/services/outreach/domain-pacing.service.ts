/**
 * LeadForge OS — Server-Authoritative Domain Pacing & Company Cardinality Service
 *
 * Enforces:
 * 1. Company contact cardinality limits (preventing aggressive outbound concentration
 *    to too many contacts at the same company/domain within a campaign).
 * 2. Domain pacing (preventing rapid-fire outbound sends to the same recipient domain).
 * 3. Race-safe concurrency control via atomic MongoDB lease reservation.
 */

import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { AutomationLockRepository } from '../../repositories/automation-lock/automation-lock.repository.js';
import { EmailDomainError } from '../email/types.js';
import {
  normalizeDomain,
  evaluateDomainPacing,
  evaluateCompanyCardinality,
  DEFAULT_OUTREACH_PACING_CONFIG,
  type OutreachPacingConfig,
  type DomainPacingEvaluation,
  type CompanyCardinalityEvaluation
} from '@leadforge/schema';
import { logger } from '../../config/index.js';

export interface CheckAndReservePacingInput {
  recipientEmail: string;
  campaignId?: string | null | undefined;
  contactId?: string | null | undefined;
  companyId?: string | null | undefined;
  campaignSettings?: any;
  requestId?: string | undefined;
  leaseDurationMs?: number | undefined;
}

export interface PacingReservationResult {
  domain: string;
  companyKey: string;
  releaseDomainLease: () => Promise<void>;
}

export class DomainPacingService {
  private readonly lockRepo: AutomationLockRepository;

  constructor(private readonly workspaceId: string) {
    this.lockRepo = new AutomationLockRepository(workspaceId);
  }

  /**
   * Resolves effective pacing configuration by merging platform defaults with campaign-level settings.
   */
  public resolveConfig(campaignSettings?: any): OutreachPacingConfig {
    const custom = campaignSettings?.pacing || campaignSettings?.outreachLimits || {};
    return {
      maxContactsPerCompany:
        typeof custom.maxContactsPerCompany === 'number' && custom.maxContactsPerCompany > 0
          ? custom.maxContactsPerCompany
          : DEFAULT_OUTREACH_PACING_CONFIG.maxContactsPerCompany,
      companyCardinalityWindowMs:
        typeof custom.companyCardinalityWindowMs === 'number' && custom.companyCardinalityWindowMs > 0
          ? custom.companyCardinalityWindowMs
          : DEFAULT_OUTREACH_PACING_CONFIG.companyCardinalityWindowMs,
      minDomainIntervalMs:
        typeof custom.minDomainIntervalMs === 'number' && custom.minDomainIntervalMs > 0
          ? custom.minDomainIntervalMs
          : DEFAULT_OUTREACH_PACING_CONFIG.minDomainIntervalMs,
      maxSendsPerDomainPerWindow:
        typeof custom.maxSendsPerDomainPerWindow === 'number' && custom.maxSendsPerDomainPerWindow > 0
          ? custom.maxSendsPerDomainPerWindow
          : DEFAULT_OUTREACH_PACING_CONFIG.maxSendsPerDomainPerWindow,
      domainPacingWindowMs:
        typeof custom.domainPacingWindowMs === 'number' && custom.domainPacingWindowMs > 0
          ? custom.domainPacingWindowMs
          : DEFAULT_OUTREACH_PACING_CONFIG.domainPacingWindowMs
    };
  }

  /**
   * Checks company cardinality against authoritative campaign delivery history.
   *
   * Invariant: If the contact was ALREADY contacted in this campaign (e.g. sequence step 2+),
   * they do NOT consume a new company slot and are always allowed.
   */
  public async checkCompanyCardinality(
    campaignId: string,
    companyIdOrDomain: string,
    currentContactId: string,
    config: OutreachPacingConfig
  ): Promise<CompanyCardinalityEvaluation> {
    if (!campaignId) {
      return {
        allowed: true,
        contactedCount: 0,
        maxAllowed: config.maxContactsPerCompany
      };
    }

    const windowStart = new Date(Date.now() - config.companyCardinalityWindowMs);

    // Query distinct contact IDs with active or completed deliveries for this company/domain in this campaign
    const companyFilter: any = {
      workspaceId: this.workspaceId,
      campaignId,
      direction: 'OUTBOUND',
      status: { $in: ['SENDING', 'SENT'] },
      createdAt: { $gte: windowStart }
    };

    if (companyIdOrDomain.includes('.')) {
      // Key is domain
      companyFilter.$or = [
        { recipientDomain: companyIdOrDomain },
        { recipientEmail: { $regex: `@${companyIdOrDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
      ];
    } else {
      // Key is companyId
      companyFilter.companyId = companyIdOrDomain;
    }

    const contactedContactIds = await EmailDeliveryModel.distinct('contactId', companyFilter);

    return evaluateCompanyCardinality(contactedContactIds, currentContactId, config);
  }

  /**
   * Checks domain pacing against authoritative recent outbound deliveries for this recipient domain.
   */
  public async checkDomainPacing(
    domain: string,
    config: OutreachPacingConfig,
    now: Date = new Date()
  ): Promise<DomainPacingEvaluation> {
    const normDomain = normalizeDomain(domain);
    if (!normDomain) {
      return { allowed: true };
    }

    const windowStart = new Date(now.getTime() - config.domainPacingWindowMs);

    const escapedDomain = normDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const recentDeliveries = await EmailDeliveryModel.find({
      workspaceId: this.workspaceId,
      direction: 'OUTBOUND',
      $and: [
        {
          $or: [
            { recipientDomain: normDomain },
            { recipientEmail: { $regex: `@${escapedDomain}$`, $options: 'i' } }
          ]
        },
        {
          $or: [
            { status: 'SENDING', leaseExpiresAt: { $gt: now } },
            { status: 'SENT', createdAt: { $gte: windowStart } }
          ]
        }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(20);

    return evaluateDomainPacing(normDomain, recentDeliveries as any, config, now);
  }

  /**
   * Canonical gate: Enforces both company cardinality and domain pacing atomically.
   *
   * Guarantees race safety across concurrent workers:
   * 1. Reads authoritative delivery history to detect existing sends/active leases.
   * 2. Uses atomic lease reservation on the destination domain so simultaneous parallel
   *    worker dispatches to the same domain cannot both proceed.
   */
  public async checkAndReservePacing(
    input: CheckAndReservePacingInput
  ): Promise<PacingReservationResult> {
    const normDomain = normalizeDomain(input.recipientEmail);
    if (!normDomain) {
      throw new EmailDomainError('INVALID_RECIPIENT', `Invalid recipient email address: "${input.recipientEmail}".`);
    }

    const companyKey = input.companyId || normDomain;
    const config = this.resolveConfig(input.campaignSettings);
    const now = new Date();

    // 1. Company Cardinality Gate
    if (input.campaignId) {
      const cardEval = await this.checkCompanyCardinality(
        input.campaignId,
        companyKey,
        input.contactId || '',
        config
      );

      if (!cardEval.allowed) {
        logger.info(
          {
            workspaceId: this.workspaceId,
            campaignId: input.campaignId,
            companyKey,
            contactId: input.contactId,
            contactedCount: cardEval.contactedCount,
            maxAllowed: cardEval.maxAllowed
          },
          'Outreach dispatch deferred: company contact cardinality limit reached'
        );

        throw new EmailDomainError(
          'COMPANY_CARDINALITY_EXCEEDED',
          cardEval.reason || `Company contact cardinality limit reached (${cardEval.contactedCount}/${cardEval.maxAllowed}) in campaign "${input.campaignId}".`,
          false,
          false
        );
      }
    }

    // 2. Domain Pacing Delivery History Gate
    const paceEval = await this.checkDomainPacing(normDomain, config, now);
    if (!paceEval.allowed) {
      logger.info(
        {
          workspaceId: this.workspaceId,
          domain: normDomain,
          retryAfterSec: paceEval.retryAfterSec
        },
        'Outreach dispatch throttled: domain pacing threshold reached'
      );

      throw new EmailDomainError(
        'DOMAIN_PACING_THROTTLED',
        paceEval.reason || `Outbound dispatch to domain "${normDomain}" is paced. Retry after ${paceEval.retryAfterSec}s.`,
        false,
        true,
        undefined,
        paceEval.retryAfterSec
      );
    }

    // 3. Concurrency & Race-Safety: Atomically acquire exclusive domain pacing lease
    const ownerId = input.requestId || `pacing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const leaseDurationMs = input.leaseDurationMs || config.minDomainIntervalMs;

    const lockResult = await this.lockRepo.acquireLock(
      'domain-pacing',
      normDomain,
      ownerId,
      leaseDurationMs
    );

    if (!lockResult.acquired) {
      logger.info(
        {
          workspaceId: this.workspaceId,
          domain: normDomain,
          ownerId
        },
        'Outreach dispatch throttled: parallel worker domain pacing lease acquired concurrently'
      );

      const waitSec = Math.ceil(leaseDurationMs / 1000);
      throw new EmailDomainError(
        'DOMAIN_PACING_THROTTLED',
        `Domain pacing active: concurrent dispatch to destination domain "${normDomain}" in progress.`,
        false,
        true,
        undefined,
        waitSec
      );
    }

    const releaseDomainLease = async () => {
      try {
        await this.lockRepo.releaseLock('domain-pacing', normDomain, ownerId);
      } catch (relErr) {
        logger.warn({ relErr, domain: normDomain }, 'Domain pacing: failed to release domain lease lock');
      }
    };

    return {
      domain: normDomain,
      companyKey,
      releaseDomainLease
    };
  }
}
