import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCHEDULER_POLICY,
  schedulerPolicySchema,
  resolveSchedulerPolicy,
  workspaceSettingsSchema
} from './workspace.js';
import { updateSchedulerPolicyDtoSchema } from '../dto/workspace.js';

describe('Workspace Scheduler Concurrency Policy Schema', () => {
  describe('Canonical Defaults', () => {
    it('provides the exact audit-verified canonical default values', () => {
      expect(DEFAULT_SCHEDULER_POLICY.globalMaxConcurrency).toBe(3);
      expect(DEFAULT_SCHEDULER_POLICY.typeLimits).toEqual({
        'scraper:maps': 1,
        'crawler:website': 2,
        'enrich:intelligence': 2,
        'outreach:campaign': 2,
        'automation:workflow': 2
      });
    });

    it('parses empty object to default values', () => {
      const parsed = schedulerPolicySchema.parse({});
      expect(parsed.globalMaxConcurrency).toBe(3);
      expect(parsed.typeLimits['scraper:maps']).toBe(1);
      expect(parsed.typeLimits['crawler:website']).toBe(2);
      expect(parsed.typeLimits['enrich:intelligence']).toBe(2);
      expect(parsed.typeLimits['outreach:campaign']).toBe(2);
      expect(parsed.typeLimits['automation:workflow']).toBe(2);
    });

    it('populates default scheduler policy inside workspaceSettingsSchema', () => {
      const settings = workspaceSettingsSchema.parse({});
      expect(settings.defaultTimezone).toBe('UTC');
      expect(settings.schedulerPolicy).toBeDefined();
      expect(settings.schedulerPolicy.globalMaxConcurrency).toBe(3);
      expect(settings.schedulerPolicy.typeLimits['scraper:maps']).toBe(1);
    });
  });

  describe('Validation Rules & Rejections', () => {
    it('rejects globalMaxConcurrency < 1', () => {
      expect(() => schedulerPolicySchema.parse({ globalMaxConcurrency: 0 })).toThrow();
      expect(() => schedulerPolicySchema.parse({ globalMaxConcurrency: -1 })).toThrow();
      expect(() => schedulerPolicySchema.parse({ globalMaxConcurrency: -10 })).toThrow();
    });

    it('rejects floating point numbers for globalMaxConcurrency', () => {
      expect(() => schedulerPolicySchema.parse({ globalMaxConcurrency: 2.5 })).toThrow();
      expect(() => schedulerPolicySchema.parse({ globalMaxConcurrency: 3.14 })).toThrow();
    });

    it('rejects non-numeric and malformed globalMaxConcurrency values', () => {
      expect(() => schedulerPolicySchema.parse({ globalMaxConcurrency: NaN })).toThrow();
      expect(() => schedulerPolicySchema.parse({ globalMaxConcurrency: Infinity })).toThrow();
      expect(() => schedulerPolicySchema.parse({ globalMaxConcurrency: '3' as any })).toThrow();
      expect(() => schedulerPolicySchema.parse({ globalMaxConcurrency: null as any })).toThrow();
    });

    it('rejects negative numbers for type limits', () => {
      expect(() =>
        schedulerPolicySchema.parse({
          typeLimits: { 'scraper:maps': -1 }
        })
      ).toThrow();
    });

    it('rejects floating point numbers, NaN, and strings in type limits', () => {
      expect(() =>
        schedulerPolicySchema.parse({
          typeLimits: { 'crawler:website': 1.5 }
        })
      ).toThrow();
      expect(() =>
        schedulerPolicySchema.parse({
          typeLimits: { 'crawler:website': NaN }
        })
      ).toThrow();
      expect(() =>
        schedulerPolicySchema.parse({
          typeLimits: { 'crawler:website': '2' as any }
        })
      ).toThrow();
    });

    it('accepts valid custom type limits and 0 for disabled job types', () => {
      const custom = schedulerPolicySchema.parse({
        globalMaxConcurrency: 5,
        typeLimits: {
          'scraper:maps': 0, // 0 is valid to disable claiming for this type
          'crawler:website': 4,
          'enrich:custom': 3
        }
      });
      expect(custom.globalMaxConcurrency).toBe(5);
      expect(custom.typeLimits['scraper:maps']).toBe(0);
      expect(custom.typeLimits['crawler:website']).toBe(4);
      expect(custom.typeLimits['enrich:custom']).toBe(3);
    });

    it('validates UpdateSchedulerPolicyDto correctly', () => {
      const validDto = updateSchedulerPolicyDtoSchema.parse({
        globalMaxConcurrency: 4,
        typeLimits: { 'outreach:campaign': 3 }
      });
      expect(validDto.globalMaxConcurrency).toBe(4);
      expect(validDto.typeLimits?.['outreach:campaign']).toBe(3);

      expect(() =>
        updateSchedulerPolicyDtoSchema.parse({ globalMaxConcurrency: 0 })
      ).toThrow();
      expect(() =>
        updateSchedulerPolicyDtoSchema.parse({ typeLimits: { 'outreach:campaign': -2 } })
      ).toThrow();
    });
  });

  describe('resolveSchedulerPolicy Resolver', () => {
    it('returns canonical defaults when raw input is undefined or null', () => {
      expect(resolveSchedulerPolicy(undefined)).toEqual(DEFAULT_SCHEDULER_POLICY);
      expect(resolveSchedulerPolicy(null)).toEqual(DEFAULT_SCHEDULER_POLICY);
      expect(resolveSchedulerPolicy('corrupted' as any)).toEqual(DEFAULT_SCHEDULER_POLICY);
      expect(resolveSchedulerPolicy(123 as any)).toEqual(DEFAULT_SCHEDULER_POLICY);
    });

    it('returns canonical defaults when raw object is malformed', () => {
      const corrupted = {
        globalMaxConcurrency: -5,
        typeLimits: { 'scraper:maps': 'invalid' }
      };
      expect(resolveSchedulerPolicy(corrupted)).toEqual(DEFAULT_SCHEDULER_POLICY);
    });

    it('resolves and preserves valid partial or customized policy', () => {
      const validCustom = {
        globalMaxConcurrency: 6,
        typeLimits: {
          'scraper:maps': 2,
          'crawler:website': 3,
          'enrich:intelligence': 2,
          'outreach:campaign': 3,
          'automation:workflow': 2
        }
      };
      const resolved = resolveSchedulerPolicy(validCustom);
      expect(resolved.globalMaxConcurrency).toBe(6);
      expect(resolved.typeLimits['scraper:maps']).toBe(2);
      expect(resolved.typeLimits['outreach:campaign']).toBe(3);
    });
  });
});
