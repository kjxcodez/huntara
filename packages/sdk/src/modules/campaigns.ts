import { HttpClient } from '../http/client.js';
import { toQueryString } from '../utils/query.js';
import type {
  Campaign,
  CreateCampaignDto,
  UpdateCampaignDto,
  CampaignFilters
} from '@huntara/schema';

export class CampaignsModule {
  constructor(private client: HttpClient) {}

  public async list(filters?: CampaignFilters): Promise<Campaign[]> {
    const queryParams = toQueryString(filters as any);
    return this.client.get<Campaign[]>(`/campaigns${queryParams}`);
  }

  public async get(id: string): Promise<Campaign> {
    return this.client.get<Campaign>(`/campaigns/${id}`);
  }

  public async create(dto: CreateCampaignDto): Promise<Campaign> {
    return this.client.post<Campaign>('/campaigns', dto);
  }

  public async update(id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    return this.client.patch<Campaign>(`/campaigns/${id}`, dto);
  }

  public async delete(id: string): Promise<void> {
    return this.client.delete<void>(`/campaigns/${id}`);
  }
  public async schedule(id: string): Promise<void> {
    return this.client.post<void>(`/campaigns/${id}/schedule`, {});
  }
}
