import { HttpClient } from '../http/client.js';
import type {
  CompanyIntelligence,
  CreateCompanyIntelligenceDto,
  BulkCompanyIntelligenceDto,
  WebsiteIntelligence,
  CreateWebsiteIntelligenceDto,
  ContactIntelligence,
  CreateContactIntelligenceDto,
  OpportunityScore,
  CreateOpportunityScoreDto,
  PageCrawl,
  CreatePageCrawlDto,
  IntelligenceSource,
  CreateIntelligenceSourceDto,
  IntelligenceEvidence,
  CreateIntelligenceEvidenceDto,
  BulkIntelligenceEvidenceDto,
  IntelligenceClaim,
  CreateIntelligenceClaimDto,
  IntelligenceInference,
  CreateIntelligenceInferenceDto,
  BulkOperationResult
} from '@huntara/schema';

export class IntelligenceModule {
  constructor(private client: HttpClient) {}

  // Company Intel
  public async getCompanyIntel(companyId: string): Promise<CompanyIntelligence | null> {
    return this.client.get<CompanyIntelligence | null>(`/intelligence/company/${companyId}`);
  }

  public async createCompanyIntel(dto: CreateCompanyIntelligenceDto): Promise<CompanyIntelligence> {
    return this.client.post<CompanyIntelligence>('/intelligence/company', dto);
  }

  public async createCompanyIntelBulk(dto: BulkCompanyIntelligenceDto): Promise<BulkOperationResult<CompanyIntelligence>> {
    return this.client.post<BulkOperationResult<CompanyIntelligence>>('/intelligence/company/bulk', dto);
  }

  // Website Intel
  public async getWebsiteIntel(companyId: string): Promise<WebsiteIntelligence | null> {
    return this.client.get<WebsiteIntelligence | null>(`/intelligence/website/${companyId}`);
  }

  public async createWebsiteIntel(dto: CreateWebsiteIntelligenceDto): Promise<WebsiteIntelligence> {
    return this.client.post<WebsiteIntelligence>('/intelligence/website', dto);
  }

  // Contact Intel
  public async getContactIntel(contactId: string): Promise<ContactIntelligence | null> {
    return this.client.get<ContactIntelligence | null>(`/intelligence/contact/${contactId}`);
  }

  public async createContactIntel(dto: CreateContactIntelligenceDto): Promise<ContactIntelligence> {
    return this.client.post<ContactIntelligence>('/intelligence/contact', dto);
  }

  // Opportunity Scores
  public async getOpportunityScore(companyId: string): Promise<OpportunityScore | null> {
    return this.client.get<OpportunityScore | null>(`/intelligence/opportunity-score/${companyId}`);
  }

  public async createOpportunityScore(dto: CreateOpportunityScoreDto): Promise<OpportunityScore> {
    return this.client.post<OpportunityScore>('/intelligence/opportunity-score', dto);
  }

  // Page Crawls
  public async createPageCrawl(dto: CreatePageCrawlDto): Promise<PageCrawl> {
    return this.client.post<PageCrawl>('/intelligence/page-crawls', dto);
  }

  public async listPageCrawls(companyId: string): Promise<PageCrawl[]> {
    return this.client.get<PageCrawl[]>(`/intelligence/page-crawls/${companyId}`);
  }

  // Sources
  public async createSource(dto: CreateIntelligenceSourceDto): Promise<IntelligenceSource> {
    return this.client.post<IntelligenceSource>('/intelligence/sources', dto);
  }

  public async listSources(companyId: string): Promise<IntelligenceSource[]> {
    return this.client.get<IntelligenceSource[]>(`/intelligence/sources/${companyId}`);
  }

  // Evidence
  public async createEvidence(dto: CreateIntelligenceEvidenceDto): Promise<IntelligenceEvidence> {
    return this.client.post<IntelligenceEvidence>('/intelligence/evidence', dto);
  }

  public async createEvidenceBulk(dto: BulkIntelligenceEvidenceDto): Promise<BulkOperationResult<IntelligenceEvidence>> {
    return this.client.post<BulkOperationResult<IntelligenceEvidence>>('/intelligence/evidence/bulk', dto);
  }

  public async listEvidence(companyId: string): Promise<IntelligenceEvidence[]> {
    return this.client.get<IntelligenceEvidence[]>(`/intelligence/evidence/${companyId}`);
  }

  // Claims
  public async createClaim(dto: CreateIntelligenceClaimDto): Promise<IntelligenceClaim> {
    return this.client.post<IntelligenceClaim>('/intelligence/claims', dto);
  }

  public async listClaims(companyId: string): Promise<IntelligenceClaim[]> {
    return this.client.get<IntelligenceClaim[]>(`/intelligence/claims/${companyId}`);
  }

  // Inferences
  public async createInference(dto: CreateIntelligenceInferenceDto): Promise<IntelligenceInference> {
    return this.client.post<IntelligenceInference>('/intelligence/inferences', dto);
  }

  public async listInferences(companyId: string): Promise<IntelligenceInference[]> {
    return this.client.get<IntelligenceInference[]>(`/intelligence/inferences/${companyId}`);
  }
}
