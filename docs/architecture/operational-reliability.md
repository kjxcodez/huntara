# Operational Reliability, Mailbox Health & Architecture Hardening

## 1. Executive Summary & Design Invariants
Phase 18 introduces hardened operational reliability across outbound dispatch, mailbox health tracking, worker execution lifecycles, and projection consistency in LeadForge OS.

### Core Invariants:
1. **Deterministic Mailbox Health**: Mailbox dispatch eligibility is strictly governed by a bounded state machine (`HEALTHY`, `COOLDOWN`, `AUTH_REQUIRED`, `DISCONNECTED`, `DEGRADED`, `BLOCKED`) evaluated synchronously prior to every send attempt.
2. **User Pause Inviolability**: Automatic mailbox recovery or cooldown expiration **must never** unpause a campaign whose `pauseReason` is `'USER_REQUESTED'`. Operator manual intent is strictly sovereign.
3. **Ambiguous Send Safety**: Network timeouts during provider dispatch are marked `EmailFailureCategory.AMBIGUOUS` and require sent-folder verification before any retry, preventing duplicate outbound sends.
4. **Single-Owner Retry Boundaries**: Retries are owned strictly by the execution queue layer. Competing exponential backoffs across nested HTTP clients and workers are prohibited.
5. **Watchdog Crash Bounding**: Worker process crashes are bounded to a maximum of 5 consecutive restarts within an evaluation window. Reaching the threshold transitions the worker to `CRASHED` and alerts the operator.
6. **Dead-Letter Lineage Preservation**: Dead-lettered jobs retain complete operational lineage (`jobId`, `executionId`, `campaignId`, `contactId`, `mailbox`, `failureCategory`, `lastError`), enabling safe audited operator requeueing.
7. **Bounded Inbound Correlation**: Inbound message re-indexing enforces a 24-hour window, maximum 5 attempts, and exponential backoff (`min(24h, 60s * 2^(attempt - 1))`) before transitioning to `UNMATCHED`.
8. **Authoritative Projection Rebuildability (FALLBACK-20)**: SQLite local projections can be fully wiped and reconstructed directly from authoritative MongoDB collections without manual SQL surgery.

---

## 2. Deterministic Mailbox Health State Machine

### States
```
               ┌──────────┐
   ┌───────────│ HEALTHY  │◄────────────┐
   │           └────┬─────┘             │
   │                │ Rate Limit (429)  │ Cooldown Expired /
   │                ▼                   │ Manual Reset
   │           ┌──────────┐             │
   │           │ COOLDOWN ├─────────────┘
   │           └────┬─────┘
   │ Auth           │
   │ Revoked        │ Reconnection Required
   ▼                ▼
┌─────────────────────────┐
│      AUTH_REQUIRED      │
└────────────┬────────────┘
             │ User Re-authenticates OAuth
             ▼
       ┌───────────┐
       │  HEALTHY  │
       └───────────┘
```

- **`HEALTHY`**: Mailbox operates normally. Eligible for immediate dispatch.
- **`COOLDOWN`**: Temporary provider rate limit encountered (e.g., HTTP 429). Outbound dispatch is deferred until `cooldownUntil` timestamp has passed.
- **`AUTH_REQUIRED`**: OAuth tokens revoked or expired (`invalid_grant`). Outbound dispatch halted until operator re-authenticates in Settings.
- **`DISCONNECTED`**: Mailbox connection explicitly disabled or unlinked by operator.
- **`DEGRADED`**: Mailbox experiencing elevated failure rates (>50% errors in sliding window) but not fully blocked.
- **`BLOCKED`**: Permanent provider policy block or administrative suspension.

### Pure Eligibility Evaluation
The helper `isMailboxEligibleForDispatch(account)` in `@leadforge/schema` evaluates dispatch eligibility deterministically:
```typescript
export function isMailboxEligibleForDispatch(account: {
  status?: string | null;
  health?: {
    state?: MailboxHealthState | string | null;
    cooldownUntil?: Date | string | null;
    consecutiveSendFailures?: number | null;
  } | null;
}): { eligible: boolean; reason?: string }
```

### Manual Health Reset API & IPC
Operators can reset mailbox health from the UI:
- **API Endpoint**: `POST /email-accounts/:id/health/reset`
- **IPC Channel**: `'email-accounts:reset-health'`
- **Effect**: Clears `cooldownUntil`, resets `consecutiveSendFailures` to 0, transitions health state back to `'HEALTHY'`.

---

## 3. Safe Cooldown & Manual Campaign Pause Preservation

### The Problem
When a mailbox experiences a provider rate limit (429), campaigns utilizing that mailbox enter a paused state. When the cooldown timer expires or the mailbox is manually reconnected, naive systems resume all paused campaigns. If an operator intentionally paused a campaign (`USER_REQUESTED`), automated cooldown resumption would improperly start outbound sends against user intent.

### Hardened Architecture
- **SQLite Campaign Schema**: Stores `pauseReason` inside `settings` JSON (e.g., `settings: '{"pauseReason":"USER_REQUESTED"}'`).
- **Scheduler & Automation Invariant**:
  ```typescript
  // Scheduler check during mailbox cooldown recovery
  if (campaign.pauseReason === 'USER_REQUESTED') {
    // PRESERVE: Operator manually paused this campaign.
    // Do NOT automatically resume.
    return;
  }
  if (campaign.pauseReason === 'MAILBOX_COOLDOWN') {
    // SAFE TO RESUME: Caused by automated cooldown.
    campaign.status = 'RUNNING';
    campaign.pauseReason = null;
  }
  ```

---

## 4. Provider Error Classification & Ambiguous Delivery Safety

Errors thrown during outbound delivery are mapped deterministically to `EmailFailureCategory`:
| Category | Conditions / Error Codes | Action |
|---|---|---|
| `RATE_LIMIT` | HTTP 429, `rateLimitExceeded`, `quotaExceeded` | Transition mailbox to `COOLDOWN` (15m + jitter). Defer execution due time. |
| `AUTH` | `invalid_grant`, `revoked`, `MAILBOX_REAUTH_REQUIRED` | Transition mailbox to `AUTH_REQUIRED`. Pause campaign. |
| `AMBIGUOUS` | Socket hang up, `ETIMEDOUT`, network drop mid-send | Flag `ambiguous: true`. **No immediate retry.** Reconcile via Sent folder. |
| `INVALID_RECIPIENT` | 550 User unknown, mail rejected invalid mailbox | Suppress address (`SuppressionModel`). Terminate sequence for contact. |
| `POLICY` | DMARC/SPF reject, spam block | Defer campaign. Log diagnostic alert. |
| `PROVIDER` | 5xx provider server error | Retry with exponential backoff (max 3 attempts). |

---

## 5. Worker Watchdog & Heartbeat Architecture

Background workers (`automation:workflow`, `scheduler:dispatcher`) emit heartbeats to `WorkerWatchdog`:

```
┌─────────────────────────────────────────────────────────────┐
│                       WorkerWatchdog                        │
│  - Tracks heartbeats (stale lease detection > 5 mins)       │
│  - Bounded crash counter (max 5 crashes in window)         │
│  - IPC Broadcast: 'worker:watchdog:status'                 │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
       Crash Count < 5                  Crash Count >= 5
       -> Restart worker process        -> Status: 'CRASHED'
       -> Increment crashCount          -> Halt restarts (prevent crash loop)
       -> Status: 'RUNNING'             -> Surface urgent operator alert
```

---

## 6. Dead-Letter Job Lineage & Operator Recovery

Jobs exceeding `maxAttempts` (default: 3) transition to the Dead-Letter Queue. Full operational lineage is preserved:

```typescript
export interface DeadLetterMetadata {
  isDeadLetter: boolean;
  deadLetterReason: string;
  deadLetteredAt: string;
  requeuedAt?: string;
  lineageReferences: {
    jobId: string;
    executionId: string;
    campaignId: string;
    contactId: string;
    mailbox: string;
    failureCategory: EmailFailureCategory;
    lastError: string;
  };
}
```

### Operator Requeue Contract
- **API Endpoint**: `POST /scheduler/dead-letters/:id/requeue`
- **IPC Channel**: `'scheduler:dead-letters:requeue'`
- **Semantics**:
  - Resets `attempt` to `0`.
  - Sets `status` to `'queued'`.
  - Sets `isDeadLetter` to `false`.
  - Records `requeuedAt` timestamp in audit trail.

---

## 7. Bounded Inbound Reply Re-indexing

Inbound reply correlation for un-indexed or pending messages (`CORRELATION_PENDING`) enforces strict bounds:
- **Max Reconciliation Attempts**: 5 attempts.
- **Exponential Backoff**:
  $$\text{backoffMs} = \min(24\text{h}, 60000 \times 2^{\text{attempt} - 1})$$
  - Attempt 1: 1 minute
  - Attempt 2: 2 minutes
  - Attempt 3: 4 minutes
  - Attempt 4: 8 minutes
  - Attempt 5: Transition to `UNMATCHED`
- **24-Hour Cutoff**: Inbound messages older than 24 hours without correlation are marked `UNMATCHED` with audit note `"Exhausted bounded re-indexing window (24h)"`.

---

## 8. Authoritative Projection Rebuildability (FALLBACK-20)

To resolve any SQLite cache divergence or corruption:
1. `ProjectionService.rebuildWorkspaceProjection(workspaceId)`:
   - Acquires workspace write lock.
   - Executes atomic SQLite transaction: deletes all cached records for `campaigns`, `sequence_executions`, and `email_deliveries`.
   - Streams authoritative MongoDB documents in batches and re-populates SQLite projection tables.
2. **Offline Delivery Analytics Hydration**: `CacheHydrator.hydrateWorkspace` populates `email_deliveries` alongside campaigns and executions, ensuring campaign analytics work immediately offline without requiring the user to open the Email Logs view.

---

## 9. Architectural Boundaries: `packages/workflow-engine` vs `automation.ts`

Per Architectural Decision Record `docs/architecture/workflow_engine_evaluation.md`:
- **`packages/workflow-engine`**: Pure tool dispatcher and DAG runner for autonomous research agents (Option C). Completely isolated from outreach scheduling.
- **`apps/api/src/workers/automation.ts`**: The sole authoritative sequence execution and outreach scheduling worker.
- **Zero Circular Dependencies**: Decoupled `worker-env.ts` eliminates circular runtime references between workers, logger, and configuration.
