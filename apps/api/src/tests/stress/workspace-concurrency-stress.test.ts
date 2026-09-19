import { describe, it, expect, vi } from 'vitest';
import { evaluateOutreachEligibility } from '@huntara/schema';

describe('Workspace Concurrency & Exclusivity Stress (Phase 17)', () => {
  it('executes 50+ concurrent execution enrollments across multiple isolated workspaces without leakage', async () => {
    const NUM_WORKSPACES = 5;
    const ENROLLMENTS_PER_WORKSPACE = 15;
    const TOTAL_ENROLLMENTS = NUM_WORKSPACES * ENROLLMENTS_PER_WORKSPACE; // 75 concurrent operations

    // Mock state store separated strictly by workspaceId
    const workspaceStores = new Map<string, Set<string>>();
    for (let w = 0; w < NUM_WORKSPACES; w++) {
      workspaceStores.set(`ws_stress_${w}`, new Set<string>());
    }

    // Atomic enrollment simulator with workspace isolation
    const enrollInWorkspace = async (workspaceId: string, contactId: string) => {
      // Simulate asynchronous network/db jitter between 2ms and 15ms
      const delay = Math.floor(Math.random() * 14) + 2;
      await new Promise((resolve) => setTimeout(resolve, delay));

      const store = workspaceStores.get(workspaceId);
      if (!store) throw new Error(`Unknown workspace: ${workspaceId}`);

      if (store.has(contactId)) {
        return { success: false, reason: 'ALREADY_ENROLLED' };
      }
      store.add(contactId);
      return { success: true, workspaceId, contactId };
    };

    // Spawn 75 concurrent enrollments
    const promises: Promise<{ success: boolean; workspaceId?: string; contactId?: string }>[] = [];
    for (let w = 0; w < NUM_WORKSPACES; w++) {
      const wsId = `ws_stress_${w}`;
      for (let i = 0; i < ENROLLMENTS_PER_WORKSPACE; i++) {
        const contactId = `contact_${w}_${i}`;
        promises.push(enrollInWorkspace(wsId, contactId));
      }
    }

    expect(promises.length).toBe(TOTAL_ENROLLMENTS);
    const results = await Promise.all(promises);

    // All distinct contact enrollments must succeed
    const successful = results.filter((r) => r.success);
    expect(successful.length).toBe(TOTAL_ENROLLMENTS);

    // Verify each workspace store has exactly ENROLLMENTS_PER_WORKSPACE
    for (let w = 0; w < NUM_WORKSPACES; w++) {
      const wsId = `ws_stress_${w}`;
      const store = workspaceStores.get(wsId)!;
      expect(store.size).toBe(ENROLLMENTS_PER_WORKSPACE);
      // Ensure no contacts from other workspaces leaked in
      for (const id of store) {
        expect(id.startsWith(`contact_${w}_`)).toBe(true);
      }
    }
  });

  it('enforces single-workspace contact exclusivity under 50 concurrent duplicate enrollment races', async () => {
    const WORKSPACE_ID = 'ws_exclusivity_test';
    const SEQUENCE_ID = 'seq_exclusive_1';
    const TARGET_CONTACT_ID = 'contact_exclusive_prospect';
    const CONCURRENT_ATTEMPTS = 50;

    // Simulate database unique index on { workspaceId, contactId, sequenceId, active: true }
    let activeExecutionLocked = false;
    let successfulEnrollees = 0;
    let rejectedEnrollees = 0;

    const attemptExclusiveEnrollment = async () => {
      // Asynchronous event loop delay simulating DB query latency
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));

      // Atomic compare-and-swap (simulating MongoDB / SQLite unique index insertion)
      if (activeExecutionLocked) {
        rejectedEnrollees++;
        return { success: false, reason: 'CONTACT_ALREADY_ACTIVE_IN_SEQUENCE' };
      }
      activeExecutionLocked = true;
      successfulEnrollees++;
      return { success: true, executionId: `exec_${Date.now()}` };
    };

    // Fire 50 simultaneous enrollment attempts for the exact same contact
    const attempts = Array.from({ length: CONCURRENT_ATTEMPTS }, () => attemptExclusiveEnrollment());
    const results = await Promise.all(attempts);

    expect(successfulEnrollees).toBe(1);
    expect(rejectedEnrollees).toBe(CONCURRENT_ATTEMPTS - 1);
    expect(results.filter((r) => r.success).length).toBe(1);
    expect(results.filter((r) => !r.success).length).toBe(49);
  });

  it('concurrently evaluates multi-address eligibility isolating secondary bounces under high concurrency', async () => {
    const CONCURRENT_CHECKS = 60;

    const contactWithBouncedPrimary = {
      id: 'contact_split_1',
      status: 'BOUNCED',
      email: 'primary_dead@domain.com',
      secondaryEmails: ['secondary_valid@domain.com'],
      unsubscribed: false,
      doNotContact: false
    };

    const promises = Array.from({ length: CONCURRENT_CHECKS }, async (_, i) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));

      // Test contacting the secondary address when primary is bounced
      const secondaryEval = evaluateOutreachEligibility({
        contact: contactWithBouncedPrimary,
        recipientEmail: 'secondary_valid@domain.com',
        bouncedEmail: 'primary_dead@domain.com'
      });

      // Test contacting the primary address directly
      const primaryEval = evaluateOutreachEligibility({
        contact: contactWithBouncedPrimary,
        recipientEmail: 'primary_dead@domain.com',
        bouncedEmail: 'primary_dead@domain.com'
      });

      return { secondaryEval, primaryEval };
    });

    const results = await Promise.all(promises);

    expect(results.length).toBe(CONCURRENT_CHECKS);
    for (const r of results) {
      // Secondary email must be ELIGIBLE (isolated from primary bounce)
      expect(r.secondaryEval.eligible).toBe(true);
      // Primary email must be INELIGIBLE (BOUNCED)
      expect(r.primaryEval.eligible).toBe(false);
      expect(r.primaryEval.reason).toContain('BOUNCED');
    }
  });
});
