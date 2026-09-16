import { describe, it, expect } from 'vitest';
import {
  normalizeDomain,
  evaluateDomainPacing,
  evaluateCompanyCardinality,
  DEFAULT_OUTREACH_PACING_CONFIG,
  type OutreachPacingConfig
} from './domain-pacing.js';

describe('Domain Pacing & Company Cardinality Engine (Schema Utilities)', () => {
  describe('normalizeDomain', () => {
    it('normalizes email addresses to clean lowercase domain', () => {
      expect(normalizeDomain('person@Example.COM')).toBe('example.com');
      expect(normalizeDomain('Person@example.com')).toBe('example.com');
      expect(normalizeDomain('user.name+tag@SUB.Domain.org')).toBe('sub.domain.org');
    });

    it('strips leading www and protocols from domains/URLs', () => {
      expect(normalizeDomain('WWW.Example.COM')).toBe('example.com');
      expect(normalizeDomain('http://www.example.com')).toBe('example.com');
      expect(normalizeDomain('https://sub.domain.co.uk/page?query=1')).toBe('sub.domain.co.uk');
      expect(normalizeDomain('example.com:8080')).toBe('example.com');
    });

    it('handles empty, null, or whitespace inputs gracefully', () => {
      expect(normalizeDomain('')).toBe('');
      expect(normalizeDomain(null)).toBe('');
      expect(normalizeDomain(undefined)).toBe('');
      expect(normalizeDomain('   ')).toBe('');
    });
  });

  describe('evaluateDomainPacing', () => {
    const config: OutreachPacingConfig = {
      ...DEFAULT_OUTREACH_PACING_CONFIG,
      minDomainIntervalMs: 60000,
      domainPacingWindowMs: 60000,
      maxSendsPerDomainPerWindow: 1
    };

    it('allows send when no prior deliveries exist for the domain', () => {
      const result = evaluateDomainPacing('example.com', [], config);
      expect(result.allowed).toBe(true);
    });

    it('throttles send when a delivery was sent to the same domain within the pacing window', () => {
      const now = new Date('2026-09-10T04:00:30Z');
      const recentDelivery = {
        recipientEmail: 'alice@example.com',
        recipientDomain: 'example.com',
        createdAt: new Date('2026-09-10T04:00:10Z'), // 20s ago
        sentAt: new Date('2026-09-10T04:00:10Z'),
        status: 'SENT'
      };

      const result = evaluateDomainPacing('bob@EXAMPLE.COM', [recentDelivery], config, now);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Domain pacing threshold reached for "example.com"');
      // 60s window - 20s elapsed = 40s remaining
      expect(result.retryAfterSec).toBe(40);
    });

    it('throttles send when another delivery to the same domain is currently in SENDING state', () => {
      const now = new Date('2026-09-10T04:00:00Z');
      const inFlightDelivery = {
        recipientEmail: 'lead1@target.com',
        recipientDomain: 'target.com',
        createdAt: now,
        status: 'SENDING'
      };

      const result = evaluateDomainPacing('lead2@target.com', [inFlightDelivery], config, now);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Domain pacing threshold reached for "target.com"');
    });

    it('allows send when prior delivery is outside the pacing window (> 60s ago)', () => {
      const now = new Date('2026-09-10T04:01:30Z');
      const oldDelivery = {
        recipientEmail: 'alice@example.com',
        recipientDomain: 'example.com',
        createdAt: new Date('2026-09-10T04:00:00Z'), // 90s ago
        sentAt: new Date('2026-09-10T04:00:00Z'),
        status: 'SENT'
      };

      const result = evaluateDomainPacing('bob@example.com', [oldDelivery], config, now);
      expect(result.allowed).toBe(true);
    });

    it('does not cross-contaminate deliveries to different domains', () => {
      const now = new Date('2026-09-10T04:00:30Z');
      const companyADelivery = {
        recipientEmail: 'alice@company-a.com',
        recipientDomain: 'company-a.com',
        createdAt: new Date('2026-09-10T04:00:20Z'),
        status: 'SENT'
      };

      const result = evaluateDomainPacing('bob@company-b.com', [companyADelivery], config, now);
      expect(result.allowed).toBe(true);
    });
  });

  describe('evaluateCompanyCardinality', () => {
    const config: OutreachPacingConfig = {
      ...DEFAULT_OUTREACH_PACING_CONFIG,
      maxContactsPerCompany: 3
    };

    it('allows contact when contacted count is below company limit', () => {
      const contactedIds = ['contact_1', 'contact_2'];
      const result = evaluateCompanyCardinality(contactedIds, 'contact_3', config);

      expect(result.allowed).toBe(true);
      expect(result.contactedCount).toBe(2);
      expect(result.maxAllowed).toBe(3);
    });

    it('disallows new contact when company limit has been reached', () => {
      const contactedIds = ['contact_1', 'contact_2', 'contact_3'];
      const result = evaluateCompanyCardinality(contactedIds, 'contact_4', config);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Company contact cardinality limit reached (3/3)');
      expect(result.contactedCount).toBe(3);
    });

    it('allows existing contacted contact even when at limit (e.g. sequence Step 2 follow-up)', () => {
      const contactedIds = ['contact_1', 'contact_2', 'contact_3'];
      // contact_2 is receiving a follow-up step in the same campaign
      const result = evaluateCompanyCardinality(contactedIds, 'contact_2', config);

      expect(result.allowed).toBe(true);
      expect(result.contactedCount).toBe(3);
    });
  });
});
