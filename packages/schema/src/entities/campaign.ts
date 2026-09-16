import { z } from 'zod';
import { CampaignStatus } from '../enums/index.js';
import { entityIdField, entityIdFieldNullable, nameField } from '../fields/common.js';

export const campaignStatusSchema = z.nativeEnum(CampaignStatus);

export const campaignStepSchema = z.object({
  id: entityIdField,
  type: z.string(),
  delayDays: z.number().int().nonnegative(),
  templateId: entityIdField
});
export type CampaignStep = z.infer<typeof campaignStepSchema>;

export const campaignSchema = z.object({
  id: entityIdField,
  workspaceId: entityIdField,
  name: nameField,
  description: z.string().nullable().optional(),
  sequenceId: entityIdFieldNullable,
  sendingAccountId: entityIdFieldNullable,
  status: campaignStatusSchema,
  steps: z.array(campaignStepSchema).default([]),
  template: z.string().nullable().optional(),
  schedule: z.any().nullable().optional(),
  timezone: z.string().default('UTC'),
  dailyLimit: z.number().int().nonnegative().default(0),
  trackingEnabled: z.boolean().default(false),
  settings: z.any().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date()
});
export type Campaign = z.infer<typeof campaignSchema>;
