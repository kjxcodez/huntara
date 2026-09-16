/**
 * LeadForge OS — Campaign Outbound Rejection Circuit Breaker Engine
 *
 * Deterministically tracks provider and recipient rejection signals,
 * evaluates rolling failure windows, and provides authoritative circuit-breaker rules.
 */

import { EmailFailureCategory } from '../enums/index.js';

export interface CampaignCircuitBreakerConfig {
  /** Maximum allowable consecutive provider/recipient rejections before tripping. Default: 3. */
  consecutiveRejectionThreshold: number;
  /** Rolling time window in milliseconds to inspect recent deliveries. Default: 15 minutes (900,000 ms). */
  windowMs: number;
  /** Maximum allowable total rejections in the rolling window before tripping. Default: 5. */
  windowRejectionThreshold: number;
  /** Minimum dispatch sample size in the window before rate-based tripping activates. Default: 10. */
  minWindowSampleSize: number;
  /** Maximum rejection rate (rejections / total attempts in window) that triggers trip. Default: 0.20 (20%). */
  rejectionRateThreshold: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CampaignCircuitBreakerConfig = {
  consecutiveRejectionThreshold: 3,
  windowMs: 15 * 60 * 1000, // 15 minutes
  windowRejectionThreshold: 5,
  minWindowSampleSize: 10,
  rejectionRateThreshold: 0.20 // 20%
};

/**
 * Failure categories that count as provider/recipient-side rejections for the circuit breaker.
 * Network glitches, auth re-logins, or internal formatting errors do NOT trip the breaker.
 */
export const CIRCUIT_BREAKER_REJECTION_CATEGORIES: readonly EmailFailureCategory[] = [
  EmailFailureCategory.POLICY,
  EmailFailureCategory.INVALID_RECIPIENT,
  EmailFailureCategory.RATE_LIMIT
];

/**
 * Returns true if a failure category is an authoritative provider rejection signal.
 */
export function isCircuitBreakerRejectionCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  const upper = String(category).toUpperCase();
  return (
    upper === EmailFailureCategory.POLICY ||
    upper === EmailFailureCategory.INVALID_RECIPIENT ||
    upper === EmailFailureCategory.RATE_LIMIT
  );
}

export interface DeliveryRecordSummary {
  status: 'SENT' | 'FAILED' | string;
  failureCategory?: string | null | undefined;
  createdAt: Date | string | number;
}

export interface CircuitBreakerEvaluation {
  shouldTrip: boolean;
  reason?: string | undefined;
  consecutiveRejections: number;
  windowRejections: number;
  windowTotalAttempts: number;
  rejectionRate: number;
}

/**
 * Pure evaluation function for campaign circuit breaker metrics against recent deliveries.
 * Deliveries are expected in reverse-chronological order (newest first).
 */
export function evaluateCircuitBreaker(
  recentDeliveries: DeliveryRecordSummary[],
  config: Partial<CampaignCircuitBreakerConfig> = {}
): CircuitBreakerEvaluation {
  const mergedConfig: CampaignCircuitBreakerConfig = {
    ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
    ...config
  };

  let consecutiveRejections = 0;
  let hitNonRejection = false;
  let windowRejections = 0;
  let windowTotalAttempts = 0;

  for (const delivery of recentDeliveries) {
    windowTotalAttempts++;

    const isFailed = delivery.status === 'FAILED';
    const isRejection = isFailed && isCircuitBreakerRejectionCategory(delivery.failureCategory);

    if (isRejection) {
      windowRejections++;
      if (!hitNonRejection) {
        consecutiveRejections++;
      }
    } else {
      // Encountered a successful send or a non-rejection failure: consecutive rejection chain ends
      hitNonRejection = true;
    }
  }

  const rejectionRate = windowTotalAttempts > 0 ? windowRejections / windowTotalAttempts : 0;

  // Condition 1: Consecutive rejections threshold reached
  if (consecutiveRejections >= mergedConfig.consecutiveRejectionThreshold) {
    return {
      shouldTrip: true,
      reason: `Consecutive provider rejections threshold reached (${consecutiveRejections}/${mergedConfig.consecutiveRejectionThreshold}).`,
      consecutiveRejections,
      windowRejections,
      windowTotalAttempts,
      rejectionRate
    };
  }

  // Condition 2: Absolute window rejections threshold reached
  if (windowRejections >= mergedConfig.windowRejectionThreshold) {
    return {
      shouldTrip: true,
      reason: `Window provider rejections threshold reached (${windowRejections} in ${mergedConfig.windowMs / 60000}m).`,
      consecutiveRejections,
      windowRejections,
      windowTotalAttempts,
      rejectionRate
    };
  }

  // Condition 3: Rejection rate threshold exceeded over minimum sample size
  if (
    windowTotalAttempts >= mergedConfig.minWindowSampleSize &&
    rejectionRate >= mergedConfig.rejectionRateThreshold
  ) {
    return {
      shouldTrip: true,
      reason: `Provider rejection rate threshold exceeded (${(rejectionRate * 100).toFixed(1)}% over ${windowTotalAttempts} attempts).`,
      consecutiveRejections,
      windowRejections,
      windowTotalAttempts,
      rejectionRate
    };
  }

  return {
    shouldTrip: false,
    consecutiveRejections,
    windowRejections,
    windowTotalAttempts,
    rejectionRate
  };
}
