import { HttpClient } from '../http/client.js';
import { toQueryString } from '../utils/query.js';

export interface DiscoveryJob {
  id: string;
  name: string;
  provider: string;
  status: string;
  progress: number;
  query: string;
  error?: string | null;
  statistics: {
    companiesFound: number;
    contactsFound: number;
    duplicates: number;
    imported: number;
  };
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface DiscoveryResult {
  id: string;
  jobId: string;
  companyName: string;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  description?: string | null;
  status: 'pending' | 'imported' | 'skipped';
  contacts: Array<{
    firstName: string;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    title?: string | null;
    linkedinUrl?: string | null;
  }>;
}

export interface DiscoveryRun {
  id: string;
  workspaceId: string;
  name: string;
  query: string;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  provider: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  resultCount: number;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export class DiscoveryModule {
  constructor(private client: HttpClient) {}

  /**
   * Retrieves workspace-wide discovery runs list.
   */
  public async listRuns(): Promise<DiscoveryRun[]> {
    return this.client.get<DiscoveryRun[]>('/discovery-runs');
  }

  public async createRun(payload: Partial<DiscoveryRun>): Promise<DiscoveryRun> {
    return this.client.post<DiscoveryRun>('/discovery-runs', payload);
  }

  public async getRun(id: string): Promise<DiscoveryRun> {
    return this.client.get<DiscoveryRun>(`/discovery-runs/${id}`);
  }

  public async listCompaniesForRun(id: string, options?: { page?: number; limit?: number }): Promise<any[]> {
    const params = new URLSearchParams();
    if (options?.page) params.append('page', String(options.page));
    if (options?.limit) params.append('limit', String(options.limit));
    const qs = params.toString();
    return this.client.get<any[]>(`/discovery-runs/${id}/companies${qs ? `?${qs}` : ''}`);
  }

  public async updateRun(id: string, payload: Partial<DiscoveryRun>): Promise<DiscoveryRun> {
    return this.client.patch<DiscoveryRun>(`/discovery-runs/${id}`, payload);
  }

  public async deleteRun(id: string): Promise<{ success: boolean; deletedCompanyIds?: string[]; deletedContactIds?: string[] }> {
    return this.client.delete<{ success: boolean; deletedCompanyIds?: string[]; deletedContactIds?: string[] }>(`/discovery-runs/${id}`);
  }

  // Alias helpers for SyncEngine compatibility
  public async list(): Promise<DiscoveryRun[]> {
    return this.listRuns();
  }

  public async create(payload: Partial<DiscoveryRun>): Promise<DiscoveryRun> {
    return this.createRun(payload);
  }

  public async update(id: string, payload: Partial<DiscoveryRun>): Promise<DiscoveryRun> {
    return this.updateRun(id, payload);
  }

  public async delete(id: string): Promise<{ success: boolean; deletedCompanyIds?: string[]; deletedContactIds?: string[] }> {
    return this.deleteRun(id);
  }

  /**
   * Retrieves workspace-wide discovery jobs list.
   */
  public async listJobs(filters?: Record<string, any>): Promise<DiscoveryJob[]> {
    const query = toQueryString(filters);
    return this.client.get<DiscoveryJob[]>(`/discovery/jobs${query}`);
  }

  /**
   * Creates/triggers a new discovery search job.
   */
  public async createJob(payload: {
    name: string;
    provider: string;
    query: string;
  }): Promise<DiscoveryJob> {
    return this.client.post<DiscoveryJob>('/discovery/jobs', payload);
  }

  /**
   * Gets detail overview metadata for a discovery job by ID.
   */
  public async getJob(id: string): Promise<DiscoveryJob> {
    return this.client.get<DiscoveryJob>(`/discovery/jobs/${id}`);
  }

  /**
   * Lists scraped lead results found by a discovery job.
   */
  public async getJobResults(id: string): Promise<DiscoveryResult[]> {
    return this.client.get<DiscoveryResult[]>(`/discovery/jobs/${id}/results`);
  }

  /**
   * Imports a single discovery result's company and contacts to CRM.
   */
  public async importResult(id: string): Promise<DiscoveryResult> {
    return this.client.post<DiscoveryResult>(`/discovery/results/${id}/import`, {});
  }

  /**
   * Skips/ignores a discovery result.
   */
  public async skipResult(id: string): Promise<DiscoveryResult> {
    return this.client.post<DiscoveryResult>(`/discovery/results/${id}/skip`, {});
  }
}
