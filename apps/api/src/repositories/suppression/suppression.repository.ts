import {
  SuppressionModel,
  type SuppressionDocument
} from '../../db/models/suppression.model.js';
import { ContactModel } from '../../db/models/contact.model.js';
import { SequenceExecutionModel } from '../../db/models/sequence-execution.model.js';
import {
  SuppressionReason,
  SuppressionTargetType,
  compareSuppressionPrecedence,
  normalizeDomain,
  ContactStatus,
  ContactEmailStatus
} from '@leadforge/schema';
import { logger } from '../../config/index.js';

export interface EffectiveSuppressionResult {
  suppressed: boolean;
  isRecipientSuppressed: boolean;
  isCompanySuppressed: boolean;
  isDomainSuppressed: boolean;
  reasons: Array<{
    targetType: SuppressionTargetType;
    targetId: string;
    reason: SuppressionReason;
    record: SuppressionDocument;
  }>;
  primaryReason?: SuppressionReason | undefined;
  message?: string | undefined;
}

export class SuppressionRepository {
  constructor(private readonly workspaceId: string) {}

  /**
   * Checks if an email is actively suppressed in the workspace (recipient-level).
   */
  public async isSuppressed(email: string): Promise<boolean> {
    if (!email) return false;
    const cleanEmail = email.toLowerCase().trim();
    const count = await SuppressionModel.countDocuments({
      workspaceId: this.workspaceId,
      $or: [
        { targetType: SuppressionTargetType.RECIPIENT, targetId: cleanEmail },
        { email: cleanEmail }
      ]
    });
    return count > 0;
  }

  /**
   * Checks if a company is marked Do Not Contact in the workspace.
   */
  public async isCompanySuppressed(companyId: string): Promise<boolean> {
    if (!companyId) return false;
    const cleanCompanyId = companyId.trim();
    const count = await SuppressionModel.countDocuments({
      workspaceId: this.workspaceId,
      targetType: SuppressionTargetType.COMPANY,
      targetId: cleanCompanyId
    });
    return count > 0;
  }

  /**
   * Checks if a domain is suppressed in the workspace.
   * Normalizes the domain using canonical normalizeDomain() before lookup.
   */
  public async isDomainSuppressed(domainOrEmail: string): Promise<boolean> {
    const normDomain = normalizeDomain(domainOrEmail);
    if (!normDomain) return false;
    const count = await SuppressionModel.countDocuments({
      workspaceId: this.workspaceId,
      targetType: SuppressionTargetType.DOMAIN,
      targetId: normDomain
    });
    return count > 0;
  }

  /**
   * Evaluates the effective additive suppression state across recipient, company, and domain.
   */
  public async evaluateEffectiveSuppression(params: {
    email: string;
    companyId?: string | null;
  }): Promise<EffectiveSuppressionResult> {
    const cleanEmail = (params.email || '').toLowerCase().trim();
    const cleanCompanyId = params.companyId ? params.companyId.trim() : null;
    const normDomain = normalizeDomain(cleanEmail);

    const conditions: any[] = [];
    if (cleanEmail) {
      conditions.push(
        { targetType: SuppressionTargetType.RECIPIENT, targetId: cleanEmail },
        { email: cleanEmail }
      );
    }
    if (cleanCompanyId) {
      conditions.push({ targetType: SuppressionTargetType.COMPANY, targetId: cleanCompanyId });
    }
    if (normDomain) {
      conditions.push({ targetType: SuppressionTargetType.DOMAIN, targetId: normDomain });
    }

    if (conditions.length === 0) {
      return {
        suppressed: false,
        isRecipientSuppressed: false,
        isCompanySuppressed: false,
        isDomainSuppressed: false,
        reasons: []
      };
    }

    const records = await SuppressionModel.find({
      workspaceId: this.workspaceId,
      $or: conditions
    });

    if (records.length === 0) {
      return {
        suppressed: false,
        isRecipientSuppressed: false,
        isCompanySuppressed: false,
        isDomainSuppressed: false,
        reasons: []
      };
    }

    let isRecipientSuppressed = false;
    let isCompanySuppressed = false;
    let isDomainSuppressed = false;
    const reasons: EffectiveSuppressionResult['reasons'] = [];

    for (const rec of records) {
      const tType = rec.targetType || SuppressionTargetType.RECIPIENT;
      if (tType === SuppressionTargetType.RECIPIENT || rec.email === cleanEmail) {
        isRecipientSuppressed = true;
        reasons.push({
          targetType: SuppressionTargetType.RECIPIENT,
          targetId: cleanEmail,
          reason: rec.reason,
          record: rec
        });
      } else if (tType === SuppressionTargetType.COMPANY && cleanCompanyId && rec.targetId === cleanCompanyId) {
        isCompanySuppressed = true;
        reasons.push({
          targetType: SuppressionTargetType.COMPANY,
          targetId: cleanCompanyId,
          reason: rec.reason,
          record: rec
        });
      } else if (tType === SuppressionTargetType.DOMAIN && normDomain && rec.targetId === normDomain) {
        isDomainSuppressed = true;
        reasons.push({
          targetType: SuppressionTargetType.DOMAIN,
          targetId: normDomain,
          reason: rec.reason,
          record: rec
        });
      }
    }

    // Sort reasons by precedence weight descending to pick primary reason
    reasons.sort((a, b) => compareSuppressionPrecedence(b.reason, a.reason));
    const primaryReason = reasons[0]?.reason;

    let message = 'Recipient is suppressed.';
    if (isCompanySuppressed && isDomainSuppressed && isRecipientSuppressed) {
      message = `Blocked by recipient suppression, company DNC, and domain suppression (${normDomain}).`;
    } else if (isCompanySuppressed) {
      message = `Company "${cleanCompanyId}" is marked Do Not Contact in workspace.`;
    } else if (isDomainSuppressed) {
      message = `Domain "${normDomain}" is suppressed in workspace.`;
    } else if (isRecipientSuppressed) {
      message = `Recipient "${cleanEmail}" is suppressed in workspace.`;
    }

    return {
      suppressed: true,
      isRecipientSuppressed,
      isCompanySuppressed,
      isDomainSuppressed,
      reasons,
      primaryReason,
      message
    };
  }

  /**
   * Retrieves suppression details for a specific email address.
   */
  public async getSuppression(email: string): Promise<SuppressionDocument | null> {
    if (!email) return null;
    const cleanEmail = email.toLowerCase().trim();
    return SuppressionModel.findOne({
      workspaceId: this.workspaceId,
      $or: [
        { targetType: SuppressionTargetType.RECIPIENT, targetId: cleanEmail },
        { email: cleanEmail }
      ]
    });
  }

  /**
   * Retrieves suppression details for a specific company.
   */
  public async getCompanySuppression(companyId: string): Promise<SuppressionDocument | null> {
    if (!companyId) return null;
    return SuppressionModel.findOne({
      workspaceId: this.workspaceId,
      targetType: SuppressionTargetType.COMPANY,
      targetId: companyId.trim()
    });
  }

  /**
   * Retrieves suppression details for a specific domain.
   */
  public async getDomainSuppression(domainOrEmail: string): Promise<SuppressionDocument | null> {
    const normDomain = normalizeDomain(domainOrEmail);
    if (!normDomain) return null;
    return SuppressionModel.findOne({
      workspaceId: this.workspaceId,
      targetType: SuppressionTargetType.DOMAIN,
      targetId: normDomain
    });
  }

  /**
   * Records a suppression for an email address while strictly enforcing suppression precedence.
   * A weaker suppression reason (e.g. HARD_BOUNCE) can never overwrite a stronger existing
   * reason (e.g. DO_NOT_CONTACT or UNSUBSCRIBED).
   */
  public async suppress(
    email: string,
    reason: SuppressionReason,
    source = 'system',
    evidence: Record<string, any> | null = null,
    suppressedBy: string | null = null,
    notes: string | null = null
  ): Promise<SuppressionDocument> {
    const cleanEmail = email.toLowerCase().trim();
    const existing = await SuppressionModel.findOne({
      workspaceId: this.workspaceId,
      $or: [
        { targetType: SuppressionTargetType.RECIPIENT, targetId: cleanEmail },
        { email: cleanEmail }
      ]
    });

    if (existing) {
      // Enforce Precedence: Only upgrade to stronger reason, never downgrade
      const comparison = compareSuppressionPrecedence(reason, existing.reason);
      const targetReason = comparison > 0 ? reason : existing.reason;

      const mergedEvidence = {
        ...(existing.evidence || {}),
        ...(evidence || {}),
        lastUpdatedReason: reason,
        lastUpdatedAt: new Date().toISOString()
      };

      existing.targetType = SuppressionTargetType.RECIPIENT;
      existing.targetId = cleanEmail;
      existing.email = cleanEmail;
      existing.reason = targetReason;
      existing.source = comparison >= 0 ? source : existing.source;
      existing.evidence = mergedEvidence;
      if (notes) existing.notes = notes;
      if (suppressedBy) existing.suppressedBy = suppressedBy;
      await existing.save();

      logger.info(
        {
          workspaceId: this.workspaceId,
          email: cleanEmail,
          targetReason,
          existingReason: existing.reason
        },
        'Updated existing email suppression record with precedence enforcement'
      );

      return existing;
    }

    const created = await SuppressionModel.create({
      workspaceId: this.workspaceId,
      targetType: SuppressionTargetType.RECIPIENT,
      targetId: cleanEmail,
      email: cleanEmail,
      reason,
      source,
      evidence,
      suppressedAt: new Date(),
      suppressedBy,
      notes
    });

    logger.info(
      {
        workspaceId: this.workspaceId,
        email: cleanEmail,
        reason,
        source
      },
      'Created new email suppression record'
    );

    return created;
  }

  /**
   * Idempotently records a company-level Do Not Contact suppression in the workspace.
   * Cancels active sequence executions for contacts belonging to this company.
   */
  public async suppressCompany(
    companyId: string,
    reason: SuppressionReason = SuppressionReason.COMPANY_DNC,
    source = 'system',
    evidence: Record<string, any> | null = null,
    suppressedBy: string | null = null,
    notes: string | null = null
  ): Promise<SuppressionDocument> {
    const cleanCompanyId = companyId.trim();
    const existing = await SuppressionModel.findOne({
      workspaceId: this.workspaceId,
      targetType: SuppressionTargetType.COMPANY,
      targetId: cleanCompanyId
    });

    if (existing) {
      const comparison = compareSuppressionPrecedence(reason, existing.reason);
      const targetReason = comparison > 0 ? reason : existing.reason;

      const mergedEvidence = {
        ...(existing.evidence || {}),
        ...(evidence || {}),
        lastUpdatedReason: reason,
        lastUpdatedAt: new Date().toISOString()
      };

      existing.reason = targetReason;
      existing.source = comparison >= 0 ? source : existing.source;
      existing.evidence = mergedEvidence;
      if (notes) existing.notes = notes;
      if (suppressedBy) existing.suppressedBy = suppressedBy;
      await existing.save();

      logger.info(
        {
          workspaceId: this.workspaceId,
          companyId: cleanCompanyId,
          targetReason,
          existingReason: existing.reason
        },
        'Updated existing company DNC record with precedence enforcement'
      );

      return existing;
    }

    const created = await SuppressionModel.create({
      workspaceId: this.workspaceId,
      targetType: SuppressionTargetType.COMPANY,
      targetId: cleanCompanyId,
      companyId: cleanCompanyId,
      reason,
      source,
      evidence,
      suppressedAt: new Date(),
      suppressedBy,
      notes
    });

    // Cascade cancellation to existing active/queued sequence executions for matching company contacts
    try {
      const matchingContactIds = await ContactModel.find({
        workspaceId: this.workspaceId,
        companyId: cleanCompanyId,
        deletedAt: null
      }).distinct('_id');

      if (matchingContactIds.length > 0) {
        const cancelRes = await SequenceExecutionModel.updateMany(
          {
            workspaceId: this.workspaceId,
            contactId: { $in: matchingContactIds.map(String) },
            status: { $in: ['PENDING', 'RUNNING', 'WAITING'] }
          },
          { $set: { status: 'CANCELLED' } }
        );

        logger.info(
          {
            workspaceId: this.workspaceId,
            companyId: cleanCompanyId,
            cancelledExecutions: cancelRes.modifiedCount
          },
          'Cancelled queued sequence executions for company DNC cascade'
        );
      }
    } catch (cancelErr) {
      logger.warn(
        { cancelErr, workspaceId: this.workspaceId, companyId: cleanCompanyId },
        'Warning during sequence execution cancellation for company DNC'
      );
    }

    logger.info(
      {
        workspaceId: this.workspaceId,
        companyId: cleanCompanyId,
        reason,
        source
      },
      'Created new company DNC suppression record'
    );

    return created;
  }

  /**
   * Idempotently records a domain-level suppression in the workspace.
   * Cancels active sequence executions for contacts belonging to this domain.
   */
  public async suppressDomain(
    domainOrEmail: string,
    reason: SuppressionReason = SuppressionReason.DOMAIN_SUPPRESSION,
    source = 'system',
    evidence: Record<string, any> | null = null,
    suppressedBy: string | null = null,
    notes: string | null = null
  ): Promise<SuppressionDocument> {
    const normDomain = normalizeDomain(domainOrEmail);
    if (!normDomain) {
      throw new Error(`Cannot suppress invalid domain: "${domainOrEmail}".`);
    }

    const existing = await SuppressionModel.findOne({
      workspaceId: this.workspaceId,
      targetType: SuppressionTargetType.DOMAIN,
      targetId: normDomain
    });

    if (existing) {
      const comparison = compareSuppressionPrecedence(reason, existing.reason);
      const targetReason = comparison > 0 ? reason : existing.reason;

      const mergedEvidence = {
        ...(existing.evidence || {}),
        ...(evidence || {}),
        lastUpdatedReason: reason,
        lastUpdatedAt: new Date().toISOString()
      };

      existing.reason = targetReason;
      existing.source = comparison >= 0 ? source : existing.source;
      existing.evidence = mergedEvidence;
      if (notes) existing.notes = notes;
      if (suppressedBy) existing.suppressedBy = suppressedBy;
      await existing.save();

      logger.info(
        {
          workspaceId: this.workspaceId,
          domain: normDomain,
          targetReason,
          existingReason: existing.reason
        },
        'Updated existing domain suppression record with precedence enforcement'
      );

      return existing;
    }

    const created = await SuppressionModel.create({
      workspaceId: this.workspaceId,
      targetType: SuppressionTargetType.DOMAIN,
      targetId: normDomain,
      domain: normDomain,
      reason,
      source,
      evidence,
      suppressedAt: new Date(),
      suppressedBy,
      notes
    });

    // Cascade cancellation to existing active/queued sequence executions for matching domain contacts
    try {
      const escapedDomain = normDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchingContactIds = await ContactModel.find({
        workspaceId: this.workspaceId,
        $or: [
          { email: { $regex: `@${escapedDomain}$`, $options: 'i' } },
          { 'additionalEmails.email': { $regex: `@${escapedDomain}$`, $options: 'i' } }
        ],
        deletedAt: null
      }).distinct('_id');

      if (matchingContactIds.length > 0) {
        const cancelRes = await SequenceExecutionModel.updateMany(
          {
            workspaceId: this.workspaceId,
            contactId: { $in: matchingContactIds.map(String) },
            status: { $in: ['PENDING', 'RUNNING', 'WAITING'] }
          },
          { $set: { status: 'CANCELLED' } }
        );

        logger.info(
          {
            workspaceId: this.workspaceId,
            domain: normDomain,
            cancelledExecutions: cancelRes.modifiedCount
          },
          'Cancelled queued sequence executions for domain suppression cascade'
        );
      }
    } catch (cancelErr) {
      logger.warn(
        { cancelErr, workspaceId: this.workspaceId, domain: normDomain },
        'Warning during sequence execution cancellation for domain suppression'
      );
    }

    logger.info(
      {
        workspaceId: this.workspaceId,
        domain: normDomain,
        reason,
        source
      },
      'Created new domain suppression record'
    );

    return created;
  }

  /**
   * Removes company DNC suppression in the workspace without affecting individual recipient suppressions.
   */
  public async unsuppressCompany(
    companyId: string,
    removedBy?: string
  ): Promise<{ unsuppressed: boolean; companyId: string }> {
    const cleanCompanyId = companyId.trim();
    const res = await SuppressionModel.deleteOne({
      workspaceId: this.workspaceId,
      targetType: SuppressionTargetType.COMPANY,
      targetId: cleanCompanyId
    });

    const deleted = (res.deletedCount ?? 0) > 0;
    logger.info(
      {
        workspaceId: this.workspaceId,
        companyId: cleanCompanyId,
        removedBy,
        deletedCount: res.deletedCount
      },
      'Unsuppressed company DNC record'
    );

    return {
      unsuppressed: deleted,
      companyId: cleanCompanyId
    };
  }

  /**
   * Removes domain suppression in the workspace without affecting individual recipient suppressions.
   */
  public async unsuppressDomain(
    domainOrEmail: string,
    removedBy?: string
  ): Promise<{ unsuppressed: boolean; domain: string }> {
    const normDomain = normalizeDomain(domainOrEmail);
    const res = await SuppressionModel.deleteOne({
      workspaceId: this.workspaceId,
      targetType: SuppressionTargetType.DOMAIN,
      targetId: normDomain
    });

    const deleted = (res.deletedCount ?? 0) > 0;
    logger.info(
      {
        workspaceId: this.workspaceId,
        domain: normDomain,
        removedBy,
        deletedCount: res.deletedCount
      },
      'Unsuppressed domain suppression record'
    );

    return {
      unsuppressed: deleted,
      domain: normDomain
    };
  }

  /**
   * Removes suppression for an email address (manual unsuppress) and synchronizes
   * contact eligibility if the contact has no remaining active suppressions (UNSUPPRESS-13).
   * Verifies contact is not still blocked by active company DNC or domain suppression.
   */
  public async unsuppress(
    email: string,
    removedBy?: string
  ): Promise<{ unsuppressed: boolean; email: string; restoredContactIds: string[] }> {
    const cleanEmail = email.toLowerCase().trim();
    const res = await SuppressionModel.deleteOne({
      workspaceId: this.workspaceId,
      $or: [
        { targetType: SuppressionTargetType.RECIPIENT, targetId: cleanEmail },
        { email: cleanEmail }
      ]
    });

    const deleted = (res.deletedCount ?? 0) > 0;
    const restoredContactIds: string[] = [];

    // UNSUPPRESS-13: Synchronize contact lifecycle and address eligibility
    if (deleted) {
      try {
        const matchingContacts = await ContactModel.find({
          workspaceId: this.workspaceId,
          $or: [{ email: cleanEmail }, { 'additionalEmails.email': cleanEmail }],
          deletedAt: null
        });

        for (const contact of matchingContacts) {
          // Check if contact has other suppressed emails
          const otherEmails: string[] = [];
          if (contact.email && contact.email.toLowerCase().trim() !== cleanEmail) {
            otherEmails.push(contact.email.toLowerCase().trim());
          }
          if (Array.isArray((contact as any).additionalEmails)) {
            for (const add of (contact as any).additionalEmails) {
              const addClean = (add?.email || '').toLowerCase().trim();
              if (addClean && addClean !== cleanEmail) {
                otherEmails.push(addClean);
              }
            }
          }

          let hasOtherSuppression = false;
          if (otherEmails.length > 0) {
            const otherSuppCount = await SuppressionModel.countDocuments({
              workspaceId: this.workspaceId,
              $or: [
                { targetType: SuppressionTargetType.RECIPIENT, targetId: { $in: otherEmails } },
                { email: { $in: otherEmails } }
              ]
            });
            hasOtherSuppression = otherSuppCount > 0;
          }

          // Check if contact is still blocked by company DNC or domain suppression
          if (!hasOtherSuppression && contact.companyId) {
            hasOtherSuppression = await this.isCompanySuppressed(contact.companyId);
          }
          if (!hasOtherSuppression && contact.email) {
            const domain = normalizeDomain(contact.email);
            if (domain) {
              hasOtherSuppression = await this.isDomainSuppressed(domain);
            }
          }

          // Narrowest restoration: only restore if no other suppressions exist
          // and contact was blocked by BOUNCED or INVALID emailStatus
          if (!hasOtherSuppression) {
            const currentStatus = contact.status;
            // Higher priority states: REPLIED, UNSUBSCRIBED, DO_NOT_CONTACT are strictly protected
            const isProtected =
              currentStatus === ContactStatus.REPLIED ||
              currentStatus === ContactStatus.UNSUBSCRIBED ||
              currentStatus === ContactStatus.DO_NOT_CONTACT ||
              currentStatus === ContactStatus.ARCHIVED;

            const updates: any = {};
            if (contact.emailStatus === ContactEmailStatus.INVALID) {
              updates.emailStatus = ContactEmailStatus.VALID;
            }

            if (!isProtected && currentStatus === ContactStatus.BOUNCED) {
              // Restore to CONTACTED (if contacted previously) or NEW
              updates.status = contact.lastContactedAt ? ContactStatus.CONTACTED : ContactStatus.NEW;
            }

            if (Object.keys(updates).length > 0) {
              await ContactModel.updateOne(
                { _id: contact._id, workspaceId: this.workspaceId },
                { $set: updates }
              );
              restoredContactIds.push(contact._id.toString());
            }
          }
        }
      } catch (contactErr) {
        logger.warn(
          { contactErr, email: cleanEmail, workspaceId: this.workspaceId },
          'Error updating contact status during unsuppression'
        );
      }
    }

    logger.info(
      {
        workspaceId: this.workspaceId,
        email: cleanEmail,
        removedBy,
        deletedCount: res.deletedCount,
        restoredContactIds
      },
      'Unsuppressed email address and synchronized contact eligibility'
    );

    return {
      unsuppressed: deleted,
      email: cleanEmail,
      restoredContactIds
    };
  }

  /**
   * Lists suppressions for the workspace.
   */
  public async listSuppressions(filter: {
    targetType?: SuppressionTargetType | string | undefined;
    reason?: string | undefined;
    limit?: number | undefined;
    skip?: number | undefined;
  } = {}): Promise<{ items: SuppressionDocument[]; total: number }> {
    const query: any = { workspaceId: this.workspaceId };
    if (filter.targetType) {
      query.targetType = filter.targetType;
    }
    if (filter.reason) {
      query.reason = filter.reason;
    }

    const limit = Math.min(filter.limit || 50, 200);
    const skip = filter.skip || 0;

    const [items, total] = await Promise.all([
      SuppressionModel.find(query).sort({ suppressedAt: -1 }).skip(skip).limit(limit),
      SuppressionModel.countDocuments(query)
    ]);

    return { items, total };
  }
}
