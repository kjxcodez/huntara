/**
 * LeadForge OS — Phase 10: Email Verification Provider Abstraction & Native Resolver
 *
 * Implements an extensible provider interface for email verification.
 * Native implementation performs DNS A/AAAA and MX resolution, disposable domain checking,
 * role account detection, and produces auditable, timestamped evidence.
 *
 * Invariant: Never marks mailboxVerified = true from DNS/MX alone.
 */

import dns from 'dns';
import {
  isDisposableEmailDomain,
  isKnownRoleAccount,
  evaluateEmailCandidate,
  type EmailVerificationResult,
  type EmailQualityEvidence
} from '@huntara/schema';

export interface EmailVerificationProvider {
  readonly name: string;
  verify(email: string): Promise<EmailVerificationResult>;
}

export interface DnsResolverOptions {
  timeoutMs?: number;
  dnsPromises?: typeof dns.promises;
}

/**
 * Native DNS and MX Email Verification Provider.
 * Safely evaluates domain routability and mail exchange infrastructure without raw SMTP probing.
 */
export class DnsEmailVerificationProvider implements EmailVerificationProvider {
  public readonly name = 'native_dns';
  private readonly dns: typeof dns.promises;

  constructor(options: DnsResolverOptions = {}) {
    this.dns = options.dnsPromises || dns.promises;
  }

  public async verify(email: string): Promise<EmailVerificationResult> {
    const rawEmail = String(email || '').trim().toLowerCase();
    const verifiedAt = new Date().toISOString();

    const candidate = evaluateEmailCandidate(rawEmail, { sourceType: 'manual' });
    const syntaxValid = Boolean(
      candidate.syntaxValid && candidate.domainValid && candidate.isIcannTld && !candidate.repaired
    );

    if (!syntaxValid) {
      return {
        email: rawEmail,
        syntaxValid: false,
        domainValid: false,
        mxValid: false,
        primaryMx: null,
        isDisposable: false,
        isRoleAccount: false,
        isCatchAll: null,
        mailboxVerified: false,
        provider: this.name,
        confidence: 1.0,
        rawDetails: { failureReason: 'Syntax or ICANN TLD invalid' },
        verifiedAt
      };
    }

    const domain = candidate.domain || rawEmail.split('@')[1] || '';
    const localPart = candidate.localPart || rawEmail.split('@')[0] || '';

    const isDisposable = isDisposableEmailDomain(domain);
    const isRoleAccount = isKnownRoleAccount(localPart);

    if (isDisposable) {
      return {
        email: rawEmail,
        syntaxValid: true,
        domainValid: true,
        mxValid: false,
        primaryMx: null,
        isDisposable: true,
        isRoleAccount,
        isCatchAll: null,
        mailboxVerified: false,
        provider: this.name,
        confidence: 0.99,
        rawDetails: { disposableDomain: domain },
        verifiedAt
      };
    }

    // 1. Resolve DNS A/AAAA records for domain
    let domainValid = false;
    try {
      const aRecords = await this.dns.resolve4(domain).catch(() => []);
      if (aRecords.length > 0) {
        domainValid = true;
      } else {
        const aaaaRecords = await this.dns.resolve6(domain).catch(() => []);
        domainValid = aaaaRecords.length > 0;
      }
    } catch {
      domainValid = false;
    }

    // 2. Resolve MX records for domain
    let mxValid = false;
    let primaryMx: string | null = null;
    let mxRecords: dns.MxRecord[] = [];

    try {
      mxRecords = await this.dns.resolveMx(domain);
      if (Array.isArray(mxRecords) && mxRecords.length > 0) {
        mxRecords.sort((a, b) => a.priority - b.priority);
        primaryMx = mxRecords[0]?.exchange?.toLowerCase() || null;
        mxValid = Boolean(primaryMx);
        domainValid = true;
      }
    } catch {
      mxValid = false;
    }

    // Calculate deterministic confidence
    let confidence = 0.5;
    if (!domainValid) {
      confidence = 0.95;
    } else if (!mxValid) {
      confidence = 0.9;
    } else {
      confidence = 0.85;
    }

    return {
      email: rawEmail,
      syntaxValid: true,
      domainValid,
      mxValid,
      primaryMx,
      isDisposable,
      isRoleAccount,
      isCatchAll: null,
      mailboxVerified: null, // Crucial invariant: MX presence does not verify mailbox!
      provider: this.name,
      confidence,
      rawDetails: {
        mxRecords: mxRecords.map((r) => ({ priority: r.priority, exchange: r.exchange }))
      },
      verifiedAt
    };
  }

  /**
   * Helper to convert an EmailVerificationResult into auditable EmailQualityEvidence items with standard TTLs.
   */
  public toEvidence(result: EmailVerificationResult): EmailQualityEvidence[] {
    const observedAt = result.verifiedAt;
    const evidenceList: EmailQualityEvidence[] = [];

    evidenceList.push({
      id: `ev_syntax_${Date.now()}`,
      source: 'syntax',
      observedAt,
      result: result.syntaxValid ? 'pass' : 'fail',
      confidence: 1.0,
      expiresAt: new Date(Date.parse(observedAt) + 90 * 86400000).toISOString()
    });

    if (result.isDisposable) {
      evidenceList.push({
        id: `ev_disp_${Date.now()}`,
        source: 'disposable_db',
        observedAt,
        result: 'fail',
        confidence: 0.99,
        expiresAt: new Date(Date.parse(observedAt) + 30 * 86400000).toISOString()
      });
    }

    evidenceList.push({
      id: `ev_dns_${Date.now()}`,
      source: 'domain_dns',
      observedAt,
      result: result.domainValid ? 'pass' : 'fail',
      confidence: 0.95,
      expiresAt: new Date(Date.parse(observedAt) + 7 * 86400000).toISOString()
    });

    evidenceList.push({
      id: `ev_mx_${Date.now()}`,
      source: 'mx',
      observedAt,
      result: result.mxValid ? 'pass' : 'fail',
      confidence: result.mxValid ? 0.9 : 0.95,
      details: {
        primaryMx: result.primaryMx,
        rawDetails: result.rawDetails
      },
      expiresAt: new Date(Date.parse(observedAt) + 14 * 86400000).toISOString()
    });

    if (result.isRoleAccount) {
      evidenceList.push({
        id: `ev_role_${Date.now()}`,
        source: 'role_account',
        observedAt,
        result: 'risky',
        confidence: 0.85,
        expiresAt: new Date(Date.parse(observedAt) + 90 * 86400000).toISOString()
      });
    }

    return evidenceList;
  }
}

/**
 * Mock Email Verification Provider for testing and deterministic offline scenarios.
 */
export class MockEmailVerificationProvider implements EmailVerificationProvider {
  public readonly name = 'mock_provider';

  constructor(
    private readonly mockResponses: Map<string, Partial<EmailVerificationResult>> = new Map()
  ) {}

  public setMock(email: string, response: Partial<EmailVerificationResult>): void {
    this.mockResponses.set(email.toLowerCase(), response);
  }

  public async verify(email: string): Promise<EmailVerificationResult> {
    const rawEmail = email.toLowerCase().trim();
    const verifiedAt = new Date().toISOString();
    const override = this.mockResponses.get(rawEmail);

    if (override) {
      return {
        email: rawEmail,
        syntaxValid: override.syntaxValid ?? true,
        domainValid: override.domainValid ?? true,
        mxValid: override.mxValid ?? true,
        primaryMx: override.primaryMx ?? 'mail.example.com',
        isDisposable: override.isDisposable ?? false,
        isRoleAccount: override.isRoleAccount ?? false,
        isCatchAll: override.isCatchAll ?? null,
        mailboxVerified: override.mailboxVerified ?? null,
        provider: this.name,
        confidence: override.confidence ?? 0.9,
        rawDetails: override.rawDetails ?? {},
        verifiedAt
      };
    }

    return {
      email: rawEmail,
      syntaxValid: true,
      domainValid: true,
      mxValid: true,
      primaryMx: 'mail.mock-domain.com',
      isDisposable: false,
      isRoleAccount: false,
      isCatchAll: null,
      mailboxVerified: null,
      provider: this.name,
      confidence: 0.85,
      rawDetails: {},
      verifiedAt
    };
  }
}
