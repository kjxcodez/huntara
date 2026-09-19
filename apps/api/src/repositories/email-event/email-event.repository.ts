import { BaseRepository } from '../base/base.repository.js';
import { EmailEventModel, type EmailEventDocument } from '../../db/models/email-event.model.js';
import { generateEntityId, type EmailEventType } from '@huntara/schema';

export interface CreateEmailEventDto {
  deliveryId: string;
  contactId?: string | null | undefined;
  campaignId?: string | null | undefined;
  type: EmailEventType;
  occurredAt?: Date | undefined;
  metadata?: Record<string, any> | null | undefined;
  dedupeKey?: string | undefined;
}

export class EmailEventRepository extends BaseRepository<EmailEventDocument> {
  constructor(workspaceId?: string) {
    super(EmailEventModel, workspaceId);
  }

  /**
   * Records an immutable email event idempotently using dedupeKey.
   */
  public async recordEvent(dto: CreateEmailEventDto): Promise<{ event: EmailEventDocument | null; isDuplicate: boolean }> {
    const wsId = this.workspaceId;
    const now = new Date();
    const occurredAt = dto.occurredAt || now;
    const dedupeKey = dto.dedupeKey || `${dto.deliveryId}_${dto.type}_${Math.floor(occurredAt.getTime() / 60000)}`;

    try {
      const created = await this.create({
        _id: generateEntityId(),
        workspaceId: wsId,
        deliveryId: dto.deliveryId,
        contactId: dto.contactId || null,
        campaignId: dto.campaignId || null,
        type: dto.type,
        occurredAt,
        receivedAt: now,
        metadata: dto.metadata || null,
        dedupeKey,
        createdAt: now,
        updatedAt: now
      } as any);

      return { event: created, isDuplicate: false };
    } catch (err: any) {
      if (err.code === 11000 || /duplicate/i.test(err.message)) {
        // Idempotent duplicate event detected
        const existing = await this.findOne({ dedupeKey });
        return { event: existing, isDuplicate: true };
      }
      throw err;
    }
  }

  /**
   * Retrieves chronological engagement events for a specific message/delivery.
   */
  public async findEventsForDelivery(deliveryId: string, limit = 100): Promise<EmailEventDocument[]> {
    return this.findMany(
      { deliveryId } as any,
      { sort: { occurredAt: 1 }, limit }
    );
  }

  /**
   * Retrieves chronological engagement events for a specific contact.
   */
  public async findEventsForContact(contactId: string, limit = 100): Promise<EmailEventDocument[]> {
    return this.findMany(
      { contactId } as any,
      { sort: { occurredAt: -1 }, limit }
    );
  }
}
