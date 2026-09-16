# Inbound Reconciliation, Suppression Consistency & Delivery Operations

## 1. Authoritative Convergence Architecture (UNSUPPRESS-13)
The central operational question answered by Phase 17 is:
> *After an inbound event or suppression-state change, does every relevant subsystem converge on one authoritative answer to "may this address/contact receive another outbound message?"*

In LeadForge OS, suppression authority is maintained hierarchically:
- **Suppression Authority Unit**: The normalized email address (`{ workspaceId, email }`) in MongoDB `SuppressionModel` and mirrored in SQLite `suppressions`.
- **Contact Lifecycle State**: Maintained in `ContactModel` and cached in SQLite `contacts`.
- **Precedence Rule**: Administrative unsuppression removes the address suppression record and safely restores contact eligibility:
  - If the contact status is `BOUNCED`:
    - If `lastContactedAt != null`, status restores to `CONTACTED`.
    - If `lastContactedAt == null`, status restores to `NEW`.
    - `emailStatus` is restored to `'VALID'`.
  - **Protected Status Invariants**: If the contact status is `REPLIED`, `DO_NOT_CONTACT`, or `UNSUBSCRIBED`, administrative unsuppression of an email address **never** overrides or demotes these terminal/opt-out states. The helper `canRestoreContactStatus(current, target)` strictly enforces this gate across API, worker, and IPC layers.

```
┌─────────────────────────────────────────────────────────────┐
│                 Administrative Unsuppress                    │
│                 (DELETE /suppressions/:email)                │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
     SuppressionModel                ContactModel (Workspace)
     DELETE { workspaceId, email }   WHERE email = target
                                       AND status = 'BOUNCED'
                                               │
                                     ┌─────────┴─────────┐
                                     ▼                   ▼
                           has lastContactedAt?   no lastContactedAt
                             -> 'CONTACTED'            -> 'NEW'
                             -> emailStatus: VALID  -> emailStatus: VALID
                                               │
                                               ▼
                             Protected: REPLIED / DNC / UNSUBSCRIBED
                             Strictly Preserved (Zero Mutation)
```

---

## 2. Multi-Address Bounce Isolation
Contacts frequently have multiple communication channels (e.g. primary corporate email `name@company.com` and secondary alias `name.alias@gmail.com`).

- **Previous Risk**: A bounce on an auxiliary or stale secondary address would mark the entire contact entity `BOUNCED`, prematurely killing outreach to an otherwise valid primary address (or vice-versa).
- **Hardened Invariant**: `evaluateOutreachEligibility()` isolates address evaluations:
  - Takes `recipientEmail` and `bouncedEmail`.
  - If `contact.status === 'BOUNCED'`, but `recipientEmail.toLowerCase() !== bouncedEmail.toLowerCase()`, outreach to the unaffected address is permitted (`eligible: true`).
  - Send-time worker verification passes the specific target address, ensuring one invalid mailbox does not corrupt the prospect's broader account lineage.

---

## 3. Inbound Reply Correlation Lifecycle
Inbound messages received from connected mailboxes (e.g. Gmail) undergo deterministic reconciliation before sequence continuation:

```
           Inbound Message Arrives
                     │
                     ▼
           [ CORRELATION_PENDING ]
                     │
       ┌─────────────┴─────────────┐
       ▼                           ▼
[ Automated Match ]        [ Unmatched Exhaustion ]
  - Message-ID / In-Reply-To   - No matching thread/header
  - Thread ID                  - No active sequence contact
  - Active Contact Email                   │
       │                                   ▼
       ▼                            [ UNMATCHED ]
   [ MATCHED ]                             │
 (confidence: high/thread/active)          ▼
       │                       [ Manual Reconciliation Form ]
       │                         (Audited Operator Action)
       ▼                                   │
Contact -> REPLIED                         ▼
Outreach Sequence Halted             [ MATCHED ]
                                 (confidence: 'manual')
```

### Ledger & Caching Representation
Both MongoDB `EmailDeliveryModel` and SQLite `email_deliveries` cache explicitly track:
- `processingStatus`: `'CORRELATION_PENDING'` | `'MATCHED'` | `'UNMATCHED'`
- `matchConfidence`: `'high'` | `'thread'` | `'contact_active'` | `'manual'` | `null`
- `reconciliationAttempts`: Integer count of correlation runs evaluated
- `reconciliationNotes`: Audit string detailing match reasoning or operator input
- `reconciledAt`: ISO 8601 timestamp of correlation finalization

---

## 4. Manual Inbound Reply Reconciliation Contract
For ambiguous replies, alias mismatches, or multi-person threads where automated heuristics cannot definitively correlate an inbound message, the system provides an audited manual workflow:

- **Endpoint**: `POST /email-deliveries/:id/manual-reconcile`
- **IPC Channel**: `'email-deliveries:manual-reconcile'`
- **Payload**:
  ```typescript
  {
    inboundDeliveryId: string;
    contactId: string;
    campaignId?: string | null;
    matchedDeliveryId?: string | null;
    notes?: string | null;
  }
  ```
- **Atomicity & Side Effects**:
  1. Validates that the inbound delivery, contact, and optional campaign belong to the caller's authorized workspace.
  2. Updates the inbound delivery: `processingStatus = 'MATCHED'`, `matchConfidence = 'manual'`, `contactId = targetContactId`, `reconciledAt = now()`.
  3. Transitions contact status: `status = 'REPLIED'`, `updatedAt = now()`.
  4. Records `REPLIED` email event in `EmailEventModel` for conversion funnel tracking.
  5. Automatically halts any active sequence executions for the contact in the associated campaign.

---

## 5. Deterministic Provider Error Classification
Provider transmission exceptions are normalized into deterministic operational categories:

| Failure Category | Classification | Retryable? | Ambiguous? | Description / Triggers |
|---|---|---|---|---|
| `AUTH` | `AUTH` | No | No | `401`, `403`, `invalid_grant`, expired refresh token, disconnected mailbox |
| `RATE_LIMIT` | `RATE_LIMIT` | Yes | No | `429`, `UserRateLimitExceeded`, quota exhaustion; activates account cooldown |
| `NETWORK` | `NETWORK` | Yes | Yes (if timeout post-send) | `500`-`599`, `ETIMEDOUT`, `ECONNRESET`, gateway drop; requires sent-folder check |
| `INVALID_RECIPIENT` | `INVALID_RECIPIENT` | No | No | `550`, `551`, `Recipient not found`, `Mailbox unavailable`; triggers auto-suppression |
| `AMBIGUOUS` | `AMBIGUOUS` | Yes | Yes | Socket disconnect during HTTP body dispatch; resolved via `email-deliveries:reconcile` |

---

## 6. Workspace Concurrency & Exclusivity Invariants
Outreach safety under concurrent scale is verified through two foundational guarantees:
1. **Multi-Workspace Isolation**:
   - Inbound replies, suppressions, and sequence enrollments for Workspace $A$ never mutate, read, or cross-contaminate Workspace $B$.
   - Verified via 50+ concurrent multi-tenant execution runs.
2. **Single-Workspace Exclusivity Exclusions**:
   - Single-workspace concurrent duplicate enrollment races are serialized.
   - Only a single active sequence execution lock is granted per `{ workspaceId, contactId, sequenceId }`, preventing double-enrollment or duplicate outbound sends.
