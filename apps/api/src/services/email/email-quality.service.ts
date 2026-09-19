import {
  evaluateEmailQuality,
  type EmailQualityResult,
  type EmailQualityEvidence,
  type EmailVerificationResult,
  SuppressionReason
} from '@huntara/schema';
import { EmailQualityModel } from '../../db/models/email-quality.model.js';
import { EmailDeliveryModel } from '../../db/models/email-delivery.model.js';
import { SuppressionRepository } from '../../repositories/suppression/suppression.repository.js';
import {
  DnsEmailVerificationProvider,
  type EmailVerificationProvider
} from './verification-provider.js';
import { logger } from '../../config/index.js';

export class EmailQualityService {
  private readonly suppressionRepo: SuppressionRepository;
  private readonly verificationProvider: EmailVerificationProvider;

  constructor(
    private readonly workspaceId: string,
    verificationProvider?: EmailVerificationProvider
  ) {
    this.suppressionRepo = new SuppressionRepository(workspaceId);
    this.verificationProvider = verificationProvider || new DnsEmailVerificationProvider();
  }

  /**
   * Evaluates complete email quality and deliverability with caching and auditable evidence.
   */
  public async evaluateEmail(
    email: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<EmailQualityResult> {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const now = new Date();

    // 1. Check workspace suppression ledger first
    const suppressionDoc = await this.suppressionRepo.getSuppression(cleanEmail);
    const suppression = suppressionDoc
      ? {
          reason: suppressionDoc.reason as SuppressionReason,
          suppressedAt: suppressionDoc.suppressedAt.toISOString()
        }
      : null;

    // 2. Check cached quality if forceRefresh is false
    if (!options.forceRefresh) {
      const cached = await EmailQualityModel.findOne({
        workspaceId: this.workspaceId,
        email: cleanEmail,
        expiresAt: { $gt: now }
      });

      if (cached) {
        // If suppression state changed since cache was written, re-evaluate
        if (suppression && cached.status !== 'SUPPRESSED') {
          return this.computeAndStoreQuality(cleanEmail, cached.evidence, suppression);
        }

        return {
          email: cached.email,
          status: cached.status as any,
          sendable: cached.sendable,
          riskLevel: cached.riskLevel,
          reasons: cached.reasons,
          evidence: cached.evidence,
          recommendedAction: cached.recommendedAction as any,
          evaluatedAt: cached.evaluatedAt.toISOString()
        };
      }
    }

    // 3. Perform DNS/MX verification
    let verificationResult: EmailVerificationResult;
    try {
      verificationResult = await this.verificationProvider.verify(cleanEmail);
    } catch (err: any) {
      logger.warn({ err, email: cleanEmail }, 'Verification provider failed during evaluateEmail');
      verificationResult = {
        email: cleanEmail,
        syntaxValid: true,
        domainValid: false,
        mxValid: false,
        primaryMx: null,
        isDisposable: false,
        isRoleAccount: false,
        isCatchAll: null,
        mailboxVerified: null,
        provider: this.verificationProvider.name,
        confidence: 0.5,
        rawDetails: { error: err.message || String(err) },
        verifiedAt: now.toISOString()
      };
    }

    const evidenceList: EmailQualityEvidence[] =
      this.verificationProvider instanceof DnsEmailVerificationProvider
        ? this.verificationProvider.toEvidence(verificationResult)
        : [
            {
              id: `ev_${Date.now()}`,
              source: 'verification_provider',
              observedAt: verificationResult.verifiedAt,
              result: verificationResult.mxValid ? 'pass' : 'fail',
              confidence: verificationResult.confidence,
              details: verificationResult.rawDetails
            }
          ];

    return this.computeAndStoreQuality(cleanEmail, evidenceList, suppression);
  }

  /**
   * Explicitly runs verification and stores newly computed evaluation.
   */
  public async verifyEmail(
    email: string
  ): Promise<{ result: EmailVerificationResult; quality: EmailQualityResult }> {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const result = await this.verificationProvider.verify(cleanEmail);

    const quality = await this.evaluateEmail(cleanEmail, { forceRefresh: true });
    return { result, quality };
  }

  private async computeAndStoreQuality(
    email: string,
    evidence: EmailQualityEvidence[],
    suppression: { reason: SuppressionReason; suppressedAt: string } | null
  ): Promise<EmailQualityResult> {
    const now = new Date();

    // Query historical deliveries for this recipient in the workspace
    const deliveries = await EmailDeliveryModel.find({
      workspaceId: this.workspaceId,
      recipientEmail: email
    })
      .sort({ createdAt: -1 })
      .limit(10);

    const historicalDeliveries = deliveries.map((d) => ({
      status: d.status,
      failureCategory: d.failureCategory || undefined,
      hasReply: Boolean(d.hasReply),
      lastRepliedAt: d.lastRepliedAt || undefined,
      sentAt: d.sentAt || undefined
    }));

    const quality = evaluateEmailQuality({
      email,
      evidence,
      suppression,
      historicalDeliveries,
      now
    });

    const expiresAt = new Date(now.getTime() + 7 * 86400000); // 7-day cache TTL

    await EmailQualityModel.findOneAndUpdate(
      { workspaceId: this.workspaceId, email },
      {
        $set: {
          status: quality.status,
          sendable: quality.sendable,
          riskLevel: quality.riskLevel,
          reasons: quality.reasons,
          evidence: quality.evidence,
          recommendedAction: quality.recommendedAction,
          evaluatedAt: now,
          expiresAt
        }
      },
      { upsert: true, new: true }
    );

    return quality;
  }
}
