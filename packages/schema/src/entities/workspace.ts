import { z } from 'zod';
import { entityIdField, entityIdFieldNullable, nameField, emailField } from '../fields/common.js';
import { WorkspaceRole, WorkspaceMemberStatus } from '../enums/index.js';

export const schedulerTypeLimitsSchema = z
  .object({
    'scraper:maps': z.number().int().min(0).default(1),
    'crawler:website': z.number().int().min(0).default(2),
    'enrich:intelligence': z.number().int().min(0).default(2),
    'outreach:campaign': z.number().int().min(0).default(2),
    'automation:workflow': z.number().int().min(0).default(2)
  })
  .catchall(z.number().int().min(0));

export type SchedulerTypeLimits = z.infer<typeof schedulerTypeLimitsSchema>;

export const schedulerPolicySchema = z.object({
  globalMaxConcurrency: z.number().int().min(1).default(3),
  typeLimits: schedulerTypeLimitsSchema.default({
    'scraper:maps': 1,
    'crawler:website': 2,
    'enrich:intelligence': 2,
    'outreach:campaign': 2,
    'automation:workflow': 2
  })
});

export type SchedulerPolicy = z.infer<typeof schedulerPolicySchema>;

export const DEFAULT_SCHEDULER_POLICY: SchedulerPolicy = Object.freeze({
  globalMaxConcurrency: 3,
  typeLimits: Object.freeze({
    'scraper:maps': 1,
    'crawler:website': 2,
    'enrich:intelligence': 2,
    'outreach:campaign': 2,
    'automation:workflow': 2
  })
});

/**
 * Deterministically resolves and validates a scheduler policy.
 * Missing or malformed configurations safely fall back to canonical defaults.
 */
export function resolveSchedulerPolicy(raw?: unknown): SchedulerPolicy {
  if (!raw || typeof raw !== 'object') {
    return {
      globalMaxConcurrency: DEFAULT_SCHEDULER_POLICY.globalMaxConcurrency,
      typeLimits: { ...DEFAULT_SCHEDULER_POLICY.typeLimits }
    };
  }
  const result = schedulerPolicySchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  return {
    globalMaxConcurrency: DEFAULT_SCHEDULER_POLICY.globalMaxConcurrency,
    typeLimits: { ...DEFAULT_SCHEDULER_POLICY.typeLimits }
  };
}

export const workspaceSettingsSchema = z.object({
  defaultTimezone: z.string().default('UTC'),
  outreachPolicy: z
    .object({
      dailyLimit: z.number().int().min(1).max(2000).nullable().optional(),
      hourlyLimit: z.number().int().min(1).max(200).nullable().optional(),
      minSendIntervalMs: z.number().int().min(1000).nullable().optional()
    })
    .nullable()
    .optional(),
  schedulerPolicy: schedulerPolicySchema.default(DEFAULT_SCHEDULER_POLICY)
});
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;

export const workspaceMemberSchema = z.object({
  id: entityIdField.optional(),
  userId: entityIdFieldNullable,
  email: emailField,
  role: z.nativeEnum(WorkspaceRole),
  status: z.nativeEnum(WorkspaceMemberStatus),
  joinedAt: z.coerce.date().nullable().optional(),
  invitedBy: entityIdFieldNullable,
  invitedAt: z.coerce.date().optional(),
  invitationToken: z.string().nullable().optional(),
  invitationExpiresAt: z.coerce.date().nullable().optional()
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

export const workspaceSchema = z.object({
  id: entityIdField,
  name: nameField,
  slug: z.string(),
  ownerId: entityIdField,
  plan: z.enum(['free', 'growth', 'enterprise']).default('free'),
  settings: workspaceSettingsSchema,
  members: z.array(workspaceMemberSchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date()
});
export type Workspace = z.infer<typeof workspaceSchema>;
