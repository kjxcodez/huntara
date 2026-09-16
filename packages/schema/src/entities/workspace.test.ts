import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCHEDULER_POLICY,
  schedulerPolicySchema,
  resolveSchedulerPolicy,
  workspaceSettingsSchema,
  OUTREACH_JOB_TYPES,
  DISCOVERY_JOB_TYPES,
  isOutreachJobType,
  isDiscoveryJobType,
  getJobResourceClass,
  resolveSchedulerCapacityAllocation
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

  describe('Scheduler Job Classification', () => {
    it('accurately identifies outreach job types', () => {
      expect(isOutreachJobType('outreach:campaign')).toBe(true);
      expect(isOutreachJobType('automation:workflow')).toBe(true);
      expect(isOutreachJobType('outreach:imap-poll')).toBe(true);
      expect(isOutreachJobType('scraper:maps')).toBe(false);
      expect(isOutreachJobType('crawler:website')).toBe(false);
      expect(isOutreachJobType('enrich:intelligence')).toBe(false);
    });

    it('accurately identifies discovery job types', () => {
      expect(isDiscoveryJobType('scraper:maps')).toBe(true);
      expect(isDiscoveryJobType('crawler:website')).toBe(true);
      expect(isDiscoveryJobType('enrich:intelligence')).toBe(true);
      expect(isDiscoveryJobType('enrich:website')).toBe(true);
      expect(isDiscoveryJobType('enrich:linkedin')).toBe(true);
      expect(isDiscoveryJobType('outreach:campaign')).toBe(false);
      expect(isDiscoveryJobType('automation:workflow')).toBe(false);
    });

    it('returns canonical resource class name', () => {
      expect(getJobResourceClass('outreach:campaign')).toBe('outreach');
      expect(getJobResourceClass('automation:workflow')).toBe('outreach');
      expect(getJobResourceClass('scraper:maps')).toBe('discovery');
      expect(getJobResourceClass('crawler:website')).toBe('discovery');
      expect(getJobResourceClass('enrich:intelligence')).toBe('discovery');
      expect(getJobResourceClass('mock:test')).toBe('other');
      expect(getJobResourceClass('unknown:custom')).toBe('other');
    });
  });

  describe('Capacity Allocation Calculation (Phase 3 Invariant)', () => {
    it('derives canonical capacity targets from default policy (G=3 -> Outreach=2, Discovery=1)', () => {
      const allocation = resolveSchedulerCapacityAllocation(DEFAULT_SCHEDULER_POLICY);
      expect(allocation.globalMaxConcurrency).toBe(3);
      expect(allocation.targetOutreachCapacity).toBe(2);
      expect(allocation.targetDiscoveryCapacity).toBe(1);
      expect(allocation.maxOutreachCapacity).toBe(3);
      expect(allocation.maxDiscoveryCapacity).toBe(3);
    });

    it('derives proportional capacity when global limit is larger (G=5 -> Outreach=2, Discovery=3)', () => {
      const customPolicy = {
        globalMaxConcurrency: 5,
        typeLimits: {
          'scraper:maps': 1,
          'crawler:website': 3,
          'enrich:intelligence': 2,
          'outreach:campaign': 2,
          'automation:workflow': 2
        }
      };
      const allocation = resolveSchedulerCapacityAllocation(customPolicy as any);
      expect(allocation.globalMaxConcurrency).toBe(5);
      expect(allocation.targetOutreachCapacity).toBe(2);
      expect(allocation.targetDiscoveryCapacity).toBe(3);
    });

    it('derives equal share when G=4 and outreach=2 (Outreach=2, Discovery=2)', () => {
      const customPolicy = {
        globalMaxConcurrency: 4,
        typeLimits: {
          'scraper:maps': 1,
          'crawler:website': 2,
          'enrich:intelligence': 2,
          'outreach:campaign': 2,
          'automation:workflow': 2
        }
      };
      const allocation = resolveSchedulerCapacityAllocation(customPolicy as any);
      expect(allocation.globalMaxConcurrency).toBe(4);
      expect(allocation.targetOutreachCapacity).toBe(2);
      expect(allocation.targetDiscoveryCapacity).toBe(2);
    });

    it('handles minimal concurrency G=1 deterministically', () => {
      const minimal = {
        globalMaxConcurrency: 1,
        typeLimits: { ...DEFAULT_SCHEDULER_POLICY.typeLimits }
      };
      const allocation = resolveSchedulerCapacityAllocation(minimal);
      expect(allocation.globalMaxConcurrency).toBe(1);
      expect(allocation.targetOutreachCapacity).toBe(1);
      expect(allocation.targetDiscoveryCapacity).toBe(1);
    });

    it('handles G=2 deterministically (Outreach=1, Discovery=1)', () => {
      const small = {
        globalMaxConcurrency: 2,
        typeLimits: { ...DEFAULT_SCHEDULER_POLICY.typeLimits }
      };
      const allocation = resolveSchedulerCapacityAllocation(small);
      expect(allocation.globalMaxConcurrency).toBe(2);
      expect(allocation.targetOutreachCapacity).toBe(1);
      expect(allocation.targetDiscoveryCapacity).toBe(1);
    });

    it('handles zero-limit job types without crashing', () => {
      const disabledOutreach = {
        globalMaxConcurrency: 3,
        typeLimits: {
          'scraper:maps': 1,
          'crawler:website': 2,
          'enrich:intelligence': 2,
          'outreach:campaign': 0,
          'automation:workflow': 0,
          'outreach:imap-poll': 0
        }
      };
      const allocation = resolveSchedulerCapacityAllocation(disabledOutreach as any);
      expect(allocation.targetOutreachCapacity).toBe(0);
      expect(allocation.targetDiscoveryCapacity).toBe(3);
    });
  });
});
