import { ContactRepository } from '../../repositories/contact/contact.repository.js';
import type { ContactDocument } from '../../db/models/contact.model.js';
import {
  createContactDtoSchema,
  updateContactDtoSchema,
  bulkContactDtoSchema,
  type CreateContactDto,
  type UpdateContactDto,
  type BulkContactDto,
  type BulkOperationResult
} from '@huntara/schema';

export class ContactService {
  private contactRepository: ContactRepository;

  constructor(workspaceId: string) {
    this.contactRepository = new ContactRepository(workspaceId);
  }

  public async getContactById(id: string): Promise<ContactDocument> {
    return this.contactRepository.findById(id);
  }

  public async listContacts(
    page?: number,
    limit?: number,
    filter?: any
  ): Promise<{ data: ContactDocument[]; total: number }> {
    const query: any = {};
    if (filter) {
      if (filter.companyId) query.companyId = filter.companyId;
      if (filter.status) query.status = filter.status;
      if (filter.email) query.email = { $regex: filter.email, $options: 'i' };
      if (filter.title) query.title = { $regex: filter.title, $options: 'i' };
      if (filter.source) query.source = filter.source;
      if (filter.search) {
        const searchRegex = { $regex: filter.search, $options: 'i' };
        query.$or = [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex },
          { title: searchRegex }
        ];
      }
    }
    return this.contactRepository.paginate(query, page, limit, { createdAt: -1 });
  }

  public async createContact(dto: CreateContactDto): Promise<ContactDocument> {
    const validated = createContactDtoSchema.parse(dto);
    if (validated.email) {
      const existing = await this.contactRepository.findByEmail(validated.email);
      if (existing) {
        const updateData: any = {};
        if (validated.companyId && !existing.companyId) {
          updateData.companyId = validated.companyId;
        }
        if (validated.phone && !existing.phone) {
          updateData.phone = validated.phone;
        }
        if (validated.firstName && (!existing.firstName || existing.firstName === 'Discovered')) {
          updateData.firstName = validated.firstName;
        }
        if (validated.lastName && !existing.lastName) {
          updateData.lastName = validated.lastName;
        }
        if (validated.emailMeta) {
          const rank: Record<string, number> = {
            mailto: 4,
            json_ld: 3,
            metadata: 2,
            dom_text: 1,
            manual: 1,
            unknown: 0
          };
          const existingMeta = (existing.emailMeta || {}) as any;
          const newRank = rank[validated.emailMeta.sourceType || 'unknown'] ?? 0;
          const oldRank = rank[existingMeta.sourceType || 'unknown'] ?? 0;
          if (newRank >= oldRank) {
            updateData.emailMeta = validated.emailMeta;
            if (validated.emailStatus) {
              updateData.emailStatus = validated.emailStatus;
            }
          }
        }
        if (Object.keys(updateData).length > 0) {
          return this.contactRepository.update(String(existing._id), updateData);
        }
        return existing;
      }
    }
    return this.contactRepository.create(validated);
  }

  public async createBulk(dto: BulkContactDto): Promise<BulkOperationResult<ContactDocument>> {
    const validated = bulkContactDtoSchema.parse(dto);
    return this.contactRepository.bulkInsert(validated.contacts);
  }

  public async updateContact(id: string, dto: UpdateContactDto): Promise<ContactDocument> {
    const validated = updateContactDtoSchema.parse(dto);
    return this.contactRepository.update(id, validated);
  }

  public async deleteContact(id: string): Promise<boolean> {
    return this.contactRepository.delete(id);
  }
}
