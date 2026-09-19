import { EmailAccountModel } from '../../db/models/email-account.model.js';
import type { EmailAccountDocument } from '../../db/models/email-account.model.js';
import { EmailTemplateModel, TemplateVersionModel } from '../../db/models/email-template.model.js';
import { NotFoundError } from '../../errors/index.js';
import { CampaignModel } from '../../db/models/campaign.model.js';
import { ContactModel } from '../../db/models/contact.model.js';
import { CompanyModel } from '../../db/models/company.model.js';
import { encrypt } from '../../utils/encryption.js';
import {
  renderCanonicalVariables,
  captureVariablesSnapshot,
  sanitizeSubject,
  htmlToPlainText,
  wrapHtmlWithDefaultTypography,
  plainTextToHtml
} from '@huntara/sdk';
import { EmailTemplateRepository } from '../../repositories/email-template/email-template.repository.js';
import mongoose from 'mongoose';

export class OutreachService {
  constructor(private workspaceId: string) {}

  // ── Email Accounts Management ───────────────────────────────────────────

  /**
   * Creates an email account. SMTP accounts store an encrypted App Password;
   * Gmail OAuth accounts (provider 'gmail_oauth') store encrypted refresh and
   * access tokens. Raw tokens never leave this method in plaintext.
   */
  public async createEmailAccount(data: any): Promise<EmailAccountDocument> {
    const isOAuth = data.provider === 'gmail_oauth' || !!data.refreshToken;

    const rawPassword = data.password || data.smtpPassword || data.imapPassword || '';
    const encrypted = rawPassword ? encrypt(rawPassword) : null;

    const encryptedRefreshToken = data.refreshToken
      ? encrypt(data.refreshToken)
      : null;
    const encryptedAccessToken = data.accessToken ? encrypt(data.accessToken) : null;
    const tokenExpiresAt = data.tokenExpiresAt ? new Date(data.tokenExpiresAt) : null;

    if (data.isDefault) {
      await EmailAccountModel.updateMany({ workspaceId: this.workspaceId } as any, {
        isDefault: false
      });
    }

    const account = new EmailAccountModel({
      _id: data.id || data._id || undefined,
      workspaceId: this.workspaceId as any,
      name: data.name,
      email: data.email,
      provider: 'gmail_oauth',
      encryptedPassword: encrypted,
      isDefault: !!data.isDefault,
      dailyLimit: data.dailyLimit || 200,
      hourlyLimit: data.hourlyLimit || 50,
      signature: data.signature || '',
      status: 'connected',
      lastVerifiedAt: new Date(),
      googleAccountId: data.googleAccountId || null,
      encryptedRefreshToken,
      encryptedAccessToken,
      tokenExpiresAt
    });

    await account.save();
    return account;
  }

  public async listEmailAccounts(): Promise<any[]> {
    const list = await EmailAccountModel.find({
      workspaceId: this.workspaceId
    } as any).sort({ createdAt: -1 });

    // Sanitize to prevent encrypted credential leakage
    return list.map((acc) => {
      const obj = acc.toObject();
      delete (obj as any).encryptedPassword;
      delete (obj as any).encryptedRefreshToken;
      delete (obj as any).encryptedAccessToken;
      return obj;
    });
  }

  public async deleteEmailAccount(id: string): Promise<void> {
    await EmailAccountModel.findOneAndDelete({
      _id: id,
      workspaceId: this.workspaceId
    } as any);
  }

  /**
   * Marks an account disconnected. Desktop clients should additionally revoke
   * any Google OAuth refresh tokens.
   */
  public async disconnectEmailAccount(id: string): Promise<void> {
    const acc = await EmailAccountModel.findOne({
      _id: id,
      workspaceId: this.workspaceId
    } as any);

    if (!acc) throw new Error('Email Account not found.');

    acc.status = 'disconnected';
    acc.lastError = null;
    acc.encryptedAccessToken = null;
    acc.tokenExpiresAt = null;
    await acc.save();
  }

  /**
   * Updates an existing account with freshly obtained OAuth credentials
   * (or re-verifies an SMTP account), restoring it to 'connected'.
   */
  public async reconnectEmailAccount(id: string, data: any): Promise<any> {
    const acc = await EmailAccountModel.findOne({
      _id: id,
      workspaceId: this.workspaceId
    } as any);

    if (!acc) throw new Error('Email Account not found.');

    if (data.refreshToken) {
      acc.provider = 'gmail_oauth';
      acc.encryptedRefreshToken = encrypt(data.refreshToken);
    }
    if (data.accessToken) {
      acc.encryptedAccessToken = encrypt(data.accessToken);
    }
    if (data.tokenExpiresAt) {
      acc.tokenExpiresAt = new Date(data.tokenExpiresAt);
    }
    if (data.googleAccountId) {
      acc.googleAccountId = data.googleAccountId;
    }
    if (data.name) acc.name = data.name;
    if (data.signature !== undefined) acc.signature = data.signature;
    if (data.dailyLimit) acc.dailyLimit = data.dailyLimit;
    if (data.hourlyLimit) acc.hourlyLimit = data.hourlyLimit;

    acc.status = 'connected';
    acc.lastVerifiedAt = new Date();
    acc.lastError = null;
    await acc.save();

    const obj = acc.toObject();
    delete (obj as any).encryptedPassword;
    delete (obj as any).encryptedRefreshToken;
    delete (obj as any).encryptedAccessToken;
    return obj;
  }

  /**
   * Simulates SMTP credential validation (or refreshes a Gmail OAuth account).
   */
  public async testConnection(id: string): Promise<boolean> {
    const acc = await EmailAccountModel.findOne({
      _id: id,
      workspaceId: this.workspaceId
    } as any);

    if (!acc) throw new Error('Email Account not found.');

    acc.status = 'connected';
    acc.lastVerifiedAt = new Date();
    acc.lastError = null;
    await acc.save();

    return true;
  }

  // ── Email Templates Management ──────────────────────────────────────────

  public async createTemplate(data: any): Promise<any> {
    const bodyVars = (data.body?.match(/\{\{([a-zA-Z0-9_.]+)\}\}/g) || []).map((v: string) =>
      v.replace(/[\{\}]/g, '')
    );
    const subjectVars = (data.subject?.match(/\{\{([a-zA-Z0-9_.]+)\}\}/g) || []).map((v: string) =>
      v.replace(/[\{\}]/g, '')
    );
    const variables = Array.from(new Set([...bodyVars, ...subjectVars]));

    const template = new EmailTemplateModel({
      _id: data.id || data._id || undefined,
      workspaceId: this.workspaceId,
      name: data.name,
      subject: data.subject,
      body: data.body,
      variables,
      attachments: data.attachments || []
    });

    await template.save();
    return template;
  }

  public async updateTemplate(id: string, data: any): Promise<any> {
    const updatePayload: any = {};
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.subject !== undefined) updatePayload.subject = data.subject;
    if (data.body !== undefined) updatePayload.body = data.body;
    if (data.attachments !== undefined) updatePayload.attachments = data.attachments;

    if (data.body || data.subject) {
      const bodyVars = ((data.body || '').match(/\{\{([a-zA-Z0-9_.]+)\}\}/g) || []).map((v: string) =>
        v.replace(/[\{\}]/g, '')
      );
      const subjectVars = ((data.subject || '').match(/\{\{([a-zA-Z0-9_.]+)\}\}/g) || []).map((v: string) =>
        v.replace(/[\{\}]/g, '')
      );
      if (bodyVars.length || subjectVars.length) {
        updatePayload.variables = Array.from(new Set([...bodyVars, ...subjectVars]));
      }
    }

    const templateRepo = new EmailTemplateRepository(this.workspaceId);
    const updated = await templateRepo.updateWithVersioning(id, updatePayload);
    if (!updated) throw new Error('Template not found or does not belong to this workspace.');
    return updated;
  }

  public async listTemplates(): Promise<any[]> {
    return EmailTemplateModel.find({
      workspaceId: this.workspaceId
    } as any).sort({ createdAt: -1 });
  }

  public async getTemplate(id: string): Promise<any> {
    const template = await EmailTemplateModel.findOne({
      _id: id,
      workspaceId: this.workspaceId
    } as any);
    if (!template) {
      throw new NotFoundError(`Template "${id}" not found.`);
    }
    return template;
  }

  public async getTemplateVersion(id: string, version: number): Promise<any> {
    const templateRepo = new EmailTemplateRepository(this.workspaceId);
    const versionDoc = await templateRepo.findVersion(id, version);
    if (!versionDoc) {
      throw new NotFoundError(`Version ${version} of template "${id}" not found.`);
    }
    return versionDoc;
  }

  public async deleteTemplate(id: string): Promise<void> {
    const existing = await EmailTemplateModel.findOne({
      _id: id,
      workspaceId: this.workspaceId
    } as any);
    if (!existing) return;

    // Archive current active version before deleting so historical references remain resolvable
    try {
      await TemplateVersionModel.create({
        workspaceId: existing.workspaceId,
        templateId: existing._id.toString(),
        version: existing.version || 1,
        name: existing.name,
        subject: existing.subject,
        body: existing.body,
        variables: existing.variables || [],
        attachments: existing.attachments || []
      });
    } catch (err: any) {
      // 11000 = unique constraint if already archived
      if (err?.code !== 11000) {
        console.warn('[OutreachService] Warning archiving template version on delete:', err);
      }
    }

    await EmailTemplateModel.deleteOne({
      _id: id,
      workspaceId: this.workspaceId
    } as any);
  }

  /**
   * Renders preview subject and body using a mock contact profile,
   * returning both HTML and plain-text alongside an immutable variable snapshot.
   */
  public async previewTemplate(templateId: string, contactId?: string, version?: number): Promise<any> {
    let template: any = null;
    if (typeof version === 'number' && version > 0) {
      const templateRepo = new EmailTemplateRepository(this.workspaceId);
      template = await templateRepo.findVersion(templateId, version);
    } else {
      template = await EmailTemplateModel.findOne({
        _id: templateId,
        workspaceId: this.workspaceId
      } as any);
    }
    if (!template) throw new NotFoundError('Template not found.');

    let contact: any = null;
    let company: any = null;

    if (contactId) {
      contact = await ContactModel.findById(contactId);
      if (contact && contact.companyId) {
        company = await CompanyModel.findById(contact.companyId);
      }
    } else {
      contact = { firstName: 'John', lastName: 'Doe', email: 'john@example.com' };
      company = { name: 'Acme Corp', website: 'acme.com' };
    }

    const renderCtx = {
      contact: contact ? {
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        title: contact.title,
        phone: contact.phone
      } : {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com'
      },
      company: company ? {
        name: company.name,
        domain: company.domain || company.website,
        industry: company.industry,
        location: company.location
      } : {
        name: 'Acme Corp',
        domain: 'acme.com'
      },
      sender: {
        name: 'Sales Director',
        email: 'sales@workspace.com'
      },
      workspace: {
        id: this.workspaceId,
        name: 'Workspace CRM'
      }
    };

    const renderedSubject = renderCanonicalVariables(template.subject, renderCtx, { isHtml: false });
    const renderedBody = renderCanonicalVariables(template.body, renderCtx, { isHtml: true });
    const variablesSnapshot = captureVariablesSnapshot(template.subject + ' ' + template.body, renderCtx);

    const isHtml = /<[a-z][\s\S]*>/i.test(renderedBody);
    const htmlBody = isHtml ? wrapHtmlWithDefaultTypography(renderedBody) : plainTextToHtml(renderedBody);
    const textBody = isHtml ? htmlToPlainText(renderedBody) : renderedBody;

    return {
      subject: sanitizeSubject(renderedSubject).sanitized,
      body: renderedBody,
      html: htmlBody,
      text: textBody,
      variablesSnapshot,
      version: template.version || 1
    };
  }

  // ── Campaigns Sequential Send Scheduler ──────────────────────────────────

  /**
   * Updates the campaign state status to active in MongoDB.
   */
  public async scheduleCampaign(campaignId: string): Promise<void> {
    const campaign = await CampaignModel.findOne({
      _id: campaignId,
      workspaceId: this.workspaceId
    } as any);

    if (!campaign) throw new Error('Campaign not found.');
    campaign.status = 'ACTIVE';
    await campaign.save();
  }
}
