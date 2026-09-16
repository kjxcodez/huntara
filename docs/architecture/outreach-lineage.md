# Immutable Outreach Lineage, Template Versioning & Composition Integrity

## 1. Template vs. TemplateVersion Semantics
- **`EmailTemplate` (Mutable Logical Container)**: Represents the living template in active use by workspace operators. It evolves monotonically: updates increment `version` and automatically archive the prior state.
- **`TemplateVersion` (Immutable Historical Record)**: Represents an unmodifiable snapshot of a template at a specific version (`version: N`). It is permanently preserved in `TemplateVersionModel` with a unique compound index `{ workspaceId, templateId, version }`. Once written, historical version snapshots are never mutated or physically deleted.

## 2. When a Template Version Becomes Pinned
- A sequence execution binds a template version at the boundary of sequence step materialization or execution initialization.
- If a sequence step defines an explicit `step.config.templateVersion`, that version is pinned.
- Otherwise, when the execution encounters a `SEND_EMAIL` step for a given `templateId`, it queries the current version of that template once, records it into `execCtx.templateVersions[templateId]`, and saves it to the execution context checkpoint.
- Throughout all subsequent runs, sequence delay resumptions, and retries, the execution strictly references that pinned version. Workers call `sdk.outreach.getTemplateVersion(templateId, pinnedVersion)` and never fall back to latest or query `listTemplates()`.

## 3. Execution Lineage Contract
Every outbound delivery is bound to an immutable execution lineage tuple:
```typescript
{
  campaignId: string | null;
  sequenceId: string;
  executionId: string;
  stepIndex: number;
  contactId: string;
  accountId: string;
  templateId: string | null;
  templateVersion: number | null;
  variablesSnapshot: Record<string, any> | null;
  messageFingerprint: string; // SHA-256
  idempotencyKey: string;
}
```
This lineage guarantees that any delivery in the ledger can be traced to the exact execution, template version, and substituted variables that generated it.

## 4. Variables Snapshot Semantics
- When an execution starts, `execCtx.contact` and `execCtx.company` are snapshotted from the database.
- During message rendering in `handleSendEmailStep`, variable resolution prioritizes the snapshotted contact values (`{ ...contact, ...execCtx.contact }`).
- Subsequent edits to the contact in CRM (e.g. changing `firstName` from "Alice" to "Bob") will not alter the message composed for an already-committed execution.
- The exact key-value pairs of all resolved tokens are recorded in `variablesSnapshot` and stored in both MongoDB and SQLite ledgers.

## 5. Canonical Message Fingerprint Contract
- Content identity is computed using SHA-256 over normalized logical inputs:
```typescript
const normalized = {
  workspaceId: input.workspaceId,
  sender: (input.senderEmail || '').toLowerCase().trim(),
  recipient: (input.recipientEmail || '').toLowerCase().trim(),
  subject: (input.subject || '').trim(),
  text: (input.textBody || '').trim(),
  html: (input.htmlBody || '').trim(),
  attachments: (input.attachmentChecksums || []).slice().sort(),
  templateId: input.templateId || null,
  templateVersion: input.templateVersion ?? null
};
return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
```
- The canonical fingerprint represents **logical message content** rather than transport or provider metadata.
- Preview composition (`composeOutboundMessage`) and actual delivery (`EmailService.send`) use this identical contract, guaranteeing 100% fingerprint parity across process boundaries.

## 6. Tracking Transformation Semantics
- Tracking transformations (open pixel injection and click redirect link rewriting) insert unique nonces (`openTrackingToken`, `clickTrackingTokens`).
- Because tracking tokens are per-send delivery nonces, the canonical fingerprint is computed on the canonical rendered HTML **prior** to tracking injection.
- This ensures that:
  1. A preview of an email generates the exact same content fingerprint as actual delivery.
  2. Retrying a delivery preserves the identical content fingerprint.

## 7. Attachment Fingerprint Semantics
- Attachments participate in content identity via `computeAttachmentChecksums(attachments)`.
- Derivation precedence:
  1. Precomputed `sha256` hash.
  2. Binary Buffer hash `sha256(data)`.
  3. Base64 payload hash `sha256(Buffer.from(contentBase64, 'base64'))`.
  4. Google Drive file identity hash `sha256(`${filename}:${fileId}:${size}`)`.
  5. Filename and size fallback `sha256(`${filename}:${size}`)`.
- Checksums are sorted alphabetically, ensuring that attachment order does not alter message fingerprint.
- Any change to attachment bytes alters the fingerprint.

## 8. Retry Lineage Guarantees
- Every retry mechanism preserves delivery lineage:
  - **In-process 429 throttle retry**: Passes original `templateId`, `templateVersion`, `variablesSnapshot`, and `idempotencyKey`.
  - **Delayed WAITING step resumption**: Restores execution context containing pinned `templateVersions` and snapshotted contact attributes.
  - **Worker crash restart**: Recovers execution from SQLite/MongoDB checkpoint with unchanged lineage.
  - **Reconciliation retry**: Re-evaluates delivery against provider using existing ledger reservation.
- Under no circumstances does a retry re-query mutable active templates or fresh contact records.

## 9. Historical Template Deletion Behavior
- Deleting a template via `DELETE /outreach/templates/:id`:
  1. Retrieves the active template.
  2. Archives its current version to `TemplateVersionModel` if not already present.
  3. Deletes the active document from `EmailTemplateModel`.
  4. Historical records in `TemplateVersionModel` remain untouched.
- `EmailTemplateRepository.findVersion(templateId, version)` checks `TemplateVersionModel` if the template is not found in active templates.
- Waiting executions and historical delivery ledger lookups referencing older versions continue to resolve cleanly.

## 10. Legacy Records Without Recoverable Lineage
- For deliveries created prior to Phase 16 where `templateVersion`, `variablesSnapshot`, or `messageFingerprint` were not recorded:
  - Fields remain `null` in both MongoDB and SQLite ledgers.
  - UI displays `"Legacy / Unversioned"` and `"None recorded"`.
  - The system never fabricates or infers false historical provenance.
