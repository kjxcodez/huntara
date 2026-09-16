import { describe, it, expect } from 'vitest';
import {
  isCircuitBreakerRejectionCategory,
  evaluateCircuitBreaker,
  DEFAULT_CIRCUIT_BREAKER_CONFIG
} from './campaign-circuit-breaker.js';
import { EmailFailureCategory } from '../enums/index.js';

describe('Campaign Circuit Breaker Schema Utilities', () => {
  describe('isCircuitBreakerRejectionCategory', () => {
    it('recognizes POLICY, INVALID_RECIPIENT, and RATE_LIMIT as rejections', () => {
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.POLICY)).toBe(true);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.INVALID_RECIPIENT)).toBe(true);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.RATE_LIMIT)).toBe(true);
    });

    it('rejects non-rejection failure categories', () => {
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.NETWORK)).toBe(false);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.AUTH)).toBe(false);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.INTERNAL)).toBe(false);
      expect(isCircuitBreakerRejectionCategory(EmailFailureCategory.AMBIGUOUS)).toBe(false);
      expect(isCircuitBreakerRejectionCategory(null)).toBe(false);
      expect(isCircuitBreakerRejectionCategory(undefined)).toBe(false);
    });
  });

  describe('evaluateCircuitBreaker', () => {
    const now = Date.now();

    it('returns shouldTrip: false when rejections are below threshold', () => {
      const deliveries = [
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: now },
        { status: 'FAILED', failureCategory: EmailFailureCategory.INVALID_RECIPIENT, createdAt: now - 1000 }
      ];

      const evalResult = evaluateCircuitBreaker(deliveries, { consecutiveRejectionThreshold: 3 });
      expect(evalResult.shouldTrip).toBe(false);
      expect(evalResult.consecutiveRejections).toBe(2);
    });

    it('returns shouldTrip: true when consecutive rejection threshold is reached', () => {
      const deliveries = [
        { status: 'FAILED', failureCategory: EmailFailureCategory.RATE_LIMIT, createdAt: now },
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: now - 1000 },
        { status: 'FAILED', failureCategory: EmailFailureCategory.INVALID_RECIPIENT, createdAt: now - 2000 }
      ];

      const evalResult = evaluateCircuitBreaker(deliveries, { consecutiveRejectionThreshold: 3 });
      expect(evalResult.shouldTrip).toBe(true);
      expect(evalResult.consecutiveRejections).toBe(3);
      expect(evalResult.reason).toContain('Consecutive provider rejections threshold reached (3/3)');
    });

    it('resets consecutive count when a successful send intervenes', () => {
      const deliveries = [
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: now },
        { status: 'SENT', createdAt: now - 1000 }, // Successful send breaks consecutive chain
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: now - 2000 },
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: now - 3000 }
      ];

      const evalResult = evaluateCircuitBreaker(deliveries, { consecutiveRejectionThreshold: 3, windowRejectionThreshold: 5 });
      expect(evalResult.shouldTrip).toBe(false);
      expect(evalResult.consecutiveRejections).toBe(1);
      expect(evalResult.windowRejections).toBe(3);
    });

    it('ignores non-rejection failures in consecutive rejection count', () => {
      const deliveries = [
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: now },
        { status: 'FAILED', failureCategory: EmailFailureCategory.NETWORK, createdAt: now - 1000 }, // Network error breaks consecutive provider rejections
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: now - 2000 }
      ];

      const evalResult = evaluateCircuitBreaker(deliveries, { consecutiveRejectionThreshold: 3, windowRejectionThreshold: 5 });
      expect(evalResult.shouldTrip).toBe(false);
      expect(evalResult.consecutiveRejections).toBe(1);
    });

    it('trips when absolute window threshold is reached even if not consecutive', () => {
      const deliveries = [
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: now },
        { status: 'SENT', createdAt: now - 1000 },
        { status: 'FAILED', failureCategory: EmailFailureCategory.INVALID_RECIPIENT, createdAt: now - 2000 },
        { status: 'SENT', createdAt: now - 3000 },
        { status: 'FAILED', failureCategory: EmailFailureCategory.RATE_LIMIT, createdAt: now - 4000 },
        { status: 'SENT', createdAt: now - 5000 },
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: now - 6000 },
        { status: 'SENT', createdAt: now - 7000 },
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: now - 8000 }
      ];

      const evalResult = evaluateCircuitBreaker(deliveries, { windowRejectionThreshold: 5, minWindowSampleSize: 20 });
      expect(evalResult.shouldTrip).toBe(true);
      expect(evalResult.windowRejections).toBe(5);
      expect(evalResult.reason).toContain('Window provider rejections threshold reached (5 in');
    });

    it('trips when rejection rate threshold is exceeded over minimum sample size', () => {
      const deliveries = [
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: now },
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: now - 1000 },
        { status: 'FAILED', failureCategory: EmailFailureCategory.POLICY, createdAt: now - 2000 },
        ...Array.from({ length: 7 }, (_, i) => ({ status: 'SENT', createdAt: now - (i + 3) * 1000 }))
      ]; // 3 rejections out of 10 total = 30% rate (exceeds default 20% threshold)

      const evalResult = evaluateCircuitBreaker(deliveries, {
        consecutiveRejectionThreshold: 5,
        windowRejectionThreshold: 10,
        minWindowSampleSize: 10,
        rejectionRateThreshold: 0.20
      });

      expect(evalResult.shouldTrip).toBe(true);
      expect(evalResult.rejectionRate).toBe(0.3);
      expect(evalResult.reason).toContain('Provider rejection rate threshold exceeded (30.0% over 10 attempts)');
    });
  });
});
