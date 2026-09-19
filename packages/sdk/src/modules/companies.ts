import { HttpClient } from '../http/client.js';
import { toQueryString } from '../utils/query.js';
import type {
  Company,
  CreateCompanyDto,
  UpdateCompanyDto,
  CompanyFilters,
  BulkCompanyDto,
  BulkOperationResult,
  DeleteCompanyMode,
  DeleteCompanyResult
} from '@huntara/schema';

export class CompaniesModule {
  constructor(private client: HttpClient) {}

  public async list(filters?: CompanyFilters): Promise<Company[]> {
    const queryParams = toQueryString(filters as any);
    return this.client.get<Company[]>(`/companies${queryParams}`);
  }

  public async get(id: string): Promise<Company> {
    return this.client.get<Company>(`/companies/${id}`);
  }

  public async create(dto: CreateCompanyDto): Promise<Company> {
    return this.client.post<Company>('/companies', dto);
  }

  public async createBulk(dto: BulkCompanyDto): Promise<BulkOperationResult<Company>> {
    return this.client.post<BulkOperationResult<Company>>('/companies/bulk', dto);
  }

  public async update(id: string, dto: UpdateCompanyDto): Promise<Company> {
    return this.client.patch<Company>(`/companies/${id}`, dto);
  }

  public async delete(
    id: string,
    options?: { mode?: DeleteCompanyMode }
  ): Promise<DeleteCompanyResult> {
    const query = options?.mode ? `?mode=${encodeURIComponent(options.mode)}` : '';
    return this.client.delete<DeleteCompanyResult>(`/companies/${id}${query}`);
  }
}
