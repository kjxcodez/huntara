import { z } from 'zod';
import { SuppressionReason, SuppressionTargetType } from '../enums/index.js';
import { entityIdField, emailField } from '../fields/common.js';

export const suppressionReasonSchema = z.nativeEnum(SuppressionReason);
export const suppressionTargetTypeSchema = z.nativeEnum(SuppressionTargetType);

export const suppressionRecordSchema = z.object({
  id: entityIdField,
  workspaceId: entityIdField,
  targetType: suppressionTargetTypeSchema.default(SuppressionTargetType.RECIPIENT),
  targetId: z.string().min(1),
  email: emailField.optional().nullable(),
  companyId: z.string().optional().nullable(),
  domain: z.string().optional().nullable(),
  reason: suppressionReasonSchema,
  source: z.string().default('system'),
  evidence: z.record(z.any()).optional().nullable(),
  suppressedAt: z.coerce.date(),
  suppressedBy: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date()
});
export type SuppressionRecord = z.infer<typeof suppressionRecordSchema>;

export const createSuppressionDtoSchema = z.object({
  targetType: suppressionTargetTypeSchema.optional().default(SuppressionTargetType.RECIPIENT),
  targetId: z.string().optional(),
  email: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  domain: z.string().optional().nullable(),
  reason: suppressionReasonSchema.optional(),
  source: z.string().optional().default('manual'),
  notes: z.string().nullable().optional(),
  evidence: z.record(z.any()).optional().nullable()
}).refine(
  (data) => {
    const type = data.targetType || SuppressionTargetType.RECIPIENT;
    if (type === SuppressionTargetType.RECIPIENT) {
      return Boolean(data.email || data.targetId);
    }
    if (type === SuppressionTargetType.COMPANY) {
      return Boolean(data.companyId || data.targetId);
    }
    if (type === SuppressionTargetType.DOMAIN) {
      return Boolean(data.domain || data.targetId);
    }
    return false;
  },
  { message: 'Must provide an identifier matching targetType (email, companyId, or domain).' }
);
export type CreateSuppressionDto = z.infer<typeof createSuppressionDtoSchema>;

