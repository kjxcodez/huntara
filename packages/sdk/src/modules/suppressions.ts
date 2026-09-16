import { HttpClient } from '../http/client.js';
import { toQueryString } from '../utils/query.js';

export interface SuppressionItem {
  id?: string;
  targetType?: 'recipient' | 'company' | 'domain';
  targetId?: string;
  email?: string | null;
  companyId?: string | null;
  domain?: string | null;
  reason: string;
  source?: string;
  evidence?: Record<string, any> | null;
  suppressedAt?: string;
  notes?: string | null;
}

export class SuppressionsModule {
  constructor(private client: HttpClient) {}

  public async list(params?: {
    targetType?: string;
    reason?: string;
    limit?: number;
    skip?: number;
  }): Promise<{ items: SuppressionItem[]; total: number }> {
    const query = toQueryString(params);
    return this.client.get<{ items: SuppressionItem[]; total: number }>(`/suppressions${query}`);
  }

  public async check(
    queryOrEmail: string | { email?: string; companyId?: string; domain?: string }
  ): Promise<{
    email?: string | null;
    companyId?: string | null;
    domain?: string | null;
    suppressed: boolean;
    suppression?: SuppressionItem | null;
    isRecipientSuppressed?: boolean;
    isCompanySuppressed?: boolean;
    isDomainSuppressed?: boolean;
    reasons?: any[];
    primaryReason?: string | null;
    message?: string;
  }> {
    if (typeof queryOrEmail === 'string') {
      return this.client.get(`/suppressions/check?email=${encodeURIComponent(queryOrEmail)}`);
    }
    const query = toQueryString(queryOrEmail);
    return this.client.get(`/suppressions/check${query}`);
  }

  public async create(data: {
    targetType?: 'recipient' | 'company' | 'domain';
    targetId?: string;
    email?: string | null;
    companyId?: string | null;
    domain?: string | null;
    reason?: string;
    source?: string | undefined;
    notes?: string | null | undefined;
    evidence?: any;
  }): Promise<SuppressionItem> {
    return this.client.post<SuppressionItem>('/suppressions', data);
  }

  public async suppressCompany(
    companyId: string,
    options?: { reason?: string; source?: string; notes?: string | null; evidence?: any }
  ): Promise<SuppressionItem> {
    return this.create({
      targetType: 'company',
      companyId,
      reason: options?.reason || 'COMPANY_DNC',
      source: options?.source || 'manual',
      notes: options?.notes,
      evidence: options?.evidence
    });
  }

  public async unsuppressCompany(
    companyId: string
  ): Promise<{ unsuppressed: boolean; companyId: string }> {
    return this.client.delete<{ unsuppressed: boolean; companyId: string }>(
      `/suppressions/company/${encodeURIComponent(companyId)}`
    );
  }

  public async suppressDomain(
    domain: string,
    options?: { reason?: string; source?: string; notes?: string | null; evidence?: any }
  ): Promise<SuppressionItem> {
    return this.create({
      targetType: 'domain',
      domain,
      reason: options?.reason || 'DOMAIN_SUPPRESSION',
      source: options?.source || 'manual',
      notes: options?.notes,
      evidence: options?.evidence
    });
  }

  public async unsuppressDomain(
    domain: string
  ): Promise<{ unsuppressed: boolean; domain: string }> {
    return this.client.delete<{ unsuppressed: boolean; domain: string }>(
      `/suppressions/domain/${encodeURIComponent(domain)}`
    );
  }

  public async delete(
    email: string
  ): Promise<{ unsuppressed: boolean; email: string; restoredContactIds?: string[] }> {
    return this.client.delete<{ unsuppressed: boolean; email: string; restoredContactIds?: string[] }>(
      `/suppressions/${encodeURIComponent(email)}`
    );
  }
}

