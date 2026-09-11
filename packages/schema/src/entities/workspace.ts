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

export const OUTREACH_JOB_TYPES = Object.freeze([
  'outreach:campaign',
  'automation:workflow',
  'outreach:imap-poll'
] as const);

export const DISCOVERY_JOB_TYPES = Object.freeze([
  'scraper:maps',
  'crawler:website',
  'enrich:intelligence',
  'enrich:website',
  'enrich:linkedin'
] as const);

export type OutreachJobType = (typeof OUTREACH_JOB_TYPES)[number];
export type DiscoveryJobType = (typeof DISCOVERY_JOB_TYPES)[number];
export type JobResourceClass = 'outreach' | 'discovery' | 'other';

export function isOutreachJobType(type: string): boolean {
  return (OUTREACH_JOB_TYPES as readonly string[]).includes(type);
}

export function isDiscoveryJobType(type: string): boolean {
  return (DISCOVERY_JOB_TYPES as readonly string[]).includes(type);
}

export function getJobResourceClass(type: string): JobResourceClass {
  if (isOutreachJobType(type)) return 'outreach';
  if (isDiscoveryJobType(type)) return 'discovery';
  return 'other';
}

export interface SchedulerCapacityAllocation {
  globalMaxConcurrency: number;
  maxOutreachCapacity: number;
  maxDiscoveryCapacity: number;
  targetOutreachCapacity: number;
  targetDiscoveryCapacity: number;
}

/**
 * Derives fair capacity targets and limits for outreach and discovery classes
 * strictly from the MongoDB-backed scheduler policy without introducing any hardcoded constants.
 */
export function resolveSchedulerCapacityAllocation(
  policy: SchedulerPolicy | { globalMaxConcurrency: number; typeLimits: Record<string, number> }
): SchedulerCapacityAllocation {
  const globalMax = Math.max(1, policy.globalMaxConcurrency);

  // Maximum concurrency outreach can reach based on configured type limits
  const outreachLimits = OUTREACH_JOB_TYPES.map((t) => policy.typeLimits[t] ?? 2);
  const sumOutreachLimits = outreachLimits.reduce((a, b) => a + b, 0);
  const maxOutreachTypeLimit = Math.max(...outreachLimits);
  const maxOutreachCapacity = Math.min(globalMax, sumOutreachLimits);

  // Maximum concurrency discovery can reach based on configured type limits
  const discoveryLimits = DISCOVERY_JOB_TYPES.map((t) => policy.typeLimits[t] ?? 2);
  const sumDiscoveryLimits = discoveryLimits.reduce((a, b) => a + b, 0);
  const maxDiscoveryTypeLimit = Math.max(...discoveryLimits);
  const maxDiscoveryCapacity = Math.min(globalMax, sumDiscoveryLimits);

  // Under contention: Outreach must have protected capacity up to its configured share,
  // while discovery is guaranteed at least 1 slot if globalMax >= 2.
  const targetOutreachCapacity =
    globalMax >= 2 ? Math.min(maxOutreachTypeLimit, globalMax - 1) : 1;

  const targetDiscoveryCapacity = Math.max(1, globalMax - targetOutreachCapacity);

  return {
    globalMaxConcurrency: globalMax,
    maxOutreachCapacity,
    maxDiscoveryCapacity,
    targetOutreachCapacity,
    targetDiscoveryCapacity
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
