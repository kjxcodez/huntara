import { z } from 'zod';
import { nameField, entityIdField } from '../fields/common.js';
import { campaignStatusSchema, campaignSchema } from '../entities/campaign.js';
import { paginationParamsSchema } from '../common/pagination.js';

export const createCampaignStepDtoSchema = z.object({
  id: entityIdField.optional(),
  type: z.string(),
  delayDays: z.number().int().nonnegative(),
  templateId: entityIdField
});
export type CreateCampaignStepDto = z.infer<typeof createCampaignStepDtoSchema>;

export const createCampaignDtoSchema = z.object({
  id: entityIdField.optional(),
  name: nameField,
  description: z.string().nullable().optional(),
  sequenceId: entityIdField.nullable().optional(),
  sendingAccountId: entityIdField.nullable().optional(),
  status: campaignStatusSchema.optional(),
  steps: z.array(createCampaignStepDtoSchema).optional(),
  template: z.string().nullable().optional(),
  schedule: z.any().nullable().optional(),
  timezone: z.string().optional(),
  dailyLimit: z.number().int().nonnegative().optional(),
  trackingEnabled: z.boolean().default(false),
  settings: z.any().nullable().optional()
});
export type CreateCampaignDto = z.input<typeof createCampaignDtoSchema>;

export const updateCampaignDtoSchema = createCampaignDtoSchema.partial();
export type UpdateCampaignDto = z.input<typeof updateCampaignDtoSchema>;

export const campaignFiltersSchema = paginationParamsSchema.extend({
  status: campaignStatusSchema.optional()
});
export type CampaignFilters = z.infer<typeof campaignFiltersSchema>;

export const campaignListResponseSchema = z.object({
  items: z.array(campaignSchema),
  total: z.number()
});
export type CampaignListResponse = z.infer<typeof campaignListResponseSchema>;
