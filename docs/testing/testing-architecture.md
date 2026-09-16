# LeadForge OS — Testing Architecture Specification

## 1. Testing Philosophy & Quality Principles
LeadForge OS is a desktop and cloud lead discovery, CRM, intelligence, and outbound campaign delivery platform. Its operations handle sensitive email communications, outbound sending quotas, third-party authentication tokens (Gmail OAuth2), and prospect relationships. Flaky, slow, or deceptively passing tests are unacceptable because delivery bugs or state corruption can lead to domain reputation damage, rate limit bans, or accidental spam.

The LeadForge OS testing architecture is governed by five non-negotiable quality principles:
1. **Deterministic Execution**: Tests must produce identical results regardless of execution order, host OS, machine load, or time of day. Time-dependent logic relies on frozen clocks or explicit timestamps.
2. **Zero External Production Side-Effects**: Tests must never connect to live external APIs (Gmail, Google Maps, hunter.io), write to production databases, or transmit live network payloads.
3. **Behavioral Invariant Protection**: Every architectural invariant established in Phases 1–6 (email sanitization, crawler DOM extraction, campaign safety, delivery reservations, idempotency, engagement tracking, reply reconciliation) must be asserted at test boundaries.
4. **Fast Feedback Loops**: Unit and contract test suites execute within seconds across all monorepo packages, enabling continuous test-driven iteration.
5. **Clear Separation of Concerns**: Unit tests verify isolated logic in-memory; contract tests verify schema/payload boundaries; integration tests verify subsystem cohesion (e.g., SQLite schema projections in the native desktop runtime).

---

## 2. Testing Layers & Scopes

The testing suite is partitioned into four distinct layers:

| Layer | Target / Scope | Runtime Environment | Execution Tool | Target Speed |
| :--- | :--- | :--- | :--- | :--- |
| **Unit** | Isolated functions, utilities, regex engines, domain state machines, scoring rules. Zero I/O. | Node.js (V8) | Vitest | < 50ms per suite |
| **Contract** | API error payloads, HTTP status mapping, tool invocation envelopes, IPC preload allowlists. | Node.js (V8) | Vitest | < 100ms per suite |
| **Integration (Mocked)** | Multi-step workflows, reply ingestion engines, delivery idempotency, fake Gmail providers. | Node.js (In-Memory) | Vitest | < 250ms per suite |
| **Integration (Native Runtime)** | SQLite database migrations, cache schema projections, 15 production dashboard queries, cross-workspace isolation. | Electron (Node ABI 130) | Desktop Runner (`scripts/run-tests.js`) | < 2s per suite |

---

## 3. Framework Selection & Justification (Vitest)

Vitest was chosen as the authoritative test runner for LeadForge OS replacing ad-hoc tsx scripts and custom assertion loops for the following technical reasons:
- **ESM and TypeScript Native Execution**: Out-of-the-box support for TypeScript and ESM without complex transpilation layers (`ts-node`, `babel-jest`).
- **Workspace & Monorepo First**: Fast path alias resolution (`@leadforge/core`, `@leadforge/schema`, `@leadforge/sdk`, `@leadforge/logger`, `@leadforge/auth`) identical to Vite and Turbo build pipelines.
- **High Concurrency & Worker Isolation**: Vitest leverages worker threads for parallel file execution, achieving complete test suite execution across 27 suites in under 5 seconds.
- **Rich Assertion & Mocking API**: Built-in `describe`, `it`, `expect`, `vi.fn()`, `vi.mock()`, and `vi.useFakeTimers()` eliminating disjoint assertion libraries (`assert`, `chai`).
- **Snapshot & Coverage Integration**: Native V8 coverage engine and snapshot testing capabilities.

---

## 4. Directory Structure & File Naming Conventions

All test suites conform to standard colocated naming conventions:
- **Unit & Logic Tests**: Placed adjacent to source files or in package-level `src/tests/` with the `.test.ts` extension (e.g., `packages/schema/src/utils/email-sanitizer.test.ts`, `apps/desktop/src/main/services/campaign-lifecycle-safety.test.ts`).
- **Contract Tests**: Placed in dedicated `contract/` directories (e.g., `apps/api/src/tests/contract/error-contracts.test.ts`).
- **Native Integration Tests**: Placed in `apps/desktop/src/main/services/*.test.ts` and explicitly registered in `apps/desktop/scripts/run-tests.js` to execute within the Electron environment.
- **Test Utilities & Doubles**: Centralized in `packages/core/src/test-utils/` (`safety-guard.ts`, `fake-gmail-provider.ts`, `factories.ts`).

---

## 5. Test Doubles Strategy (Fakes vs Mocks vs Stubs)

To prevent brittle tests, LeadForge OS prioritizes **State-Based Verification** with authoritative test doubles over extensive call-spying:
- **Fake Gmail Provider (`FakeGmailProvider`)**: An authoritative, in-memory implementation of the Gmail provider interface. It maintains sent messages, message threads, search indices, and simulates error codes (`RATE_LIMITED`, `AUTH_ERROR`, `TIMEOUT`, `PERMANENT_REJECTION`) deterministically.
- **In-Memory SQLite / Execution Stores**: Used in unit suites (`campaign-lifecycle-safety.test.ts`, `email-delivery-engagement.test.ts`, `scheduler-recovery.test.ts`) to verify CAS compare-and-swap, reservations, and idempotency without requiring binary native compilation.
- **Stubs (`vi.fn()`, `vi.mock()`)**: Used strictly at hard external system boundaries (e.g., Electron `ipcMain`, `app.getPath()`, `fetch`).

---

## 6. Safety Guards & Production Data Protection

To guarantee that tests can never inadvertently execute against live infrastructure, the test architecture introduces an authoritative safety guard:

```typescript
// packages/core/src/test-utils/safety-guard.ts
export class ProductionSafetyViolationError extends Error {
  constructor(message: string) {
    super(`[PRODUCTION SAFETY VIOLATION] ${message}`);
    this.name = 'ProductionSafetyViolationError';
  }
}

export function assertTestEnvironment(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_PROD_TESTS) {
    throw new ProductionSafetyViolationError('Tests cannot run in NODE_ENV=production');
  }
}

export function assertSafeDatabaseTarget(uri: string): void {
  if (isTestMode()) {
    if (!uri.includes('localhost') && !uri.includes('127.0.0.1') && !uri.includes('test') && !uri.includes('memory')) {
      throw new ProductionSafetyViolationError(
        `Attempted to connect to non-test database in test mode: "${uri}". Only localhost, test databases, or :memory: are permitted.`
      );
    }
  }
}
```

The guard ensures:
- `isTestMode()` is active whenever `NODE_ENV=test`, `VITEST=true`, or `TEST_MODE=true`.
- Any attempt to instantiate Gmail OAuth or connect to remote MongoDB databases throws an immediate `ProductionSafetyViolationError`.

---

## 7. Test Data Factories & Builders

Typed, deterministic data factories are provided in `packages/core/src/test-utils/factories.ts` to ensure consistency and compliance with TypeScript's `exactOptionalPropertyTypes: true` compiler setting:
- `createTestWorkspace(overrides?)`: Generates a valid workspace object.
- `createTestUser(overrides?)`: Generates user records with roles and preferences.
- `createTestCompany(overrides?)`: Generates company models with domains and locations.
- `createTestContact(overrides?)`: Generates contact models with email, status, and metadata.
- `createTestEmailAccount(overrides?)`: Generates mailbox configurations with daily and hourly quotas.
- `createTestCampaign(overrides?)`: Generates campaign configurations with schedule boundaries.
- `createTestDelivery(overrides?)`: Generates delivery records with reservation tokens and attempt counters.
- `createTestEmailEvent(overrides?)`: Generates tracked engagement events (opens, clicks, bounces).

---

## 8. Concurrency, Isolation & State Cleanup

Vitest runs test files concurrently across separate worker threads. To prevent state pollution:
1. **No Shared Static Mutables**: Singletons must either be instantiated per-test or reset in `beforeEach()`.
2. **Explicit Teardown Hooks**: Handlers, timers, and listeners registered during test runs are torn down in `afterEach()` (e.g., `globalThis.fetch = originalFetch`, `vi.clearAllMocks()`).
3. **Workspace Isolation**: Database queries always partition by `workspaceId` using `randomUUID()`, verifying that Workspace A cannot read or mutate Workspace B state.

---

## 9. Package-by-Package Testing Map

| Package | Test Suites | Test Count | Focus Areas |
| :--- | :--- | :--- | :--- |
| **`@leadforge/schema`** | `email-sanitizer.test.ts`, `outreach-eligibility.test.ts`, `tracking.test.ts` | 62 | RFC email syntax, role account detection, contact eligibility, open/click tokens. |
| **`@leadforge/sdk`** | `variable-resolver.test.ts` | 8 | Template variable resolution (`{{contact.firstName}}`), legacy token fallback, escaping. |
| **`@leadforge/core`** | `safety-guard.ts`, `fake-gmail-provider.ts`, `factories.ts` | Utilities | Test doubles, safety guards, typed builders. |
| **`@leadforge/agent-core`** | `registry.test.ts` | 3 | Tool registration, duplicate tool rejection, catalog discovery. |
| **`@leadforge/agent-runtime`**| `runtime.test.ts` | 1 | Agent state machine transitions, tool result dispatching. |
| **`@leadforge/workflow-engine`**| `tool-prompt-builder.test.ts`, `tool-dispatcher.test.ts`, `workflow-runner.test.ts` | 13 | Step sequencing, context accumulation, bounded fan-out, failure stopping. |
| **`api` (`apps/api`)** | `gmail-oauth-refresh.test.ts`, `gmail-phase9r.test.ts`, `error-contracts.test.ts` | 17 | Token refresh mechanics, retry policies, API error contracts & HTTP status codes. |
| **`@leadforge/desktop` (Unit)**| `crawler-extractor.test.ts`, `campaign-lifecycle-safety.test.ts`, `email-delivery-engagement.test.ts`, `email-reply-reconciliation.test.ts`, `desktop-runtime-config.test.ts`, `locations.test.ts`, `worker-auth.test.ts`, `send-test-attachment.test.ts`, `intelligence.test.ts`, `playwright-setup.test.ts`, `adapter.test.ts`, `updater.test.ts`, `email-test-recipients.test.ts`, `scheduler-recovery.test.ts`, `onboarding.test.ts` | 98 | DOM crawler extraction, send reservations, reply reconciliation, update manager. |
| **`@leadforge/desktop` (Native)**| `audiences.test.ts`, `campaign.test.ts`, `fresh-database.test.ts`, `fresh-database-all-queries.test.ts`, `post-release-stabilization.test.ts`, `release-qualification.test.ts` | 6 suites | SQLite cache schema versioning, 15 production queries, cross-workspace isolation. |
| **Total Monorepo** | **27 Vitest Suites + 6 Native Suites** | **202 Unit + Native** | **100% Passing** |

---

## 10. CI Quality Gates & Pipeline Integration

The CI pipeline (.github/workflows/ci.yml and .github/workflows/quality.yml) executes test suites automatically on every pull request and push to `main`:
- **`ci.yml`**:
  1. `pnpm install --frozen-lockfile`
  2. `pnpm run lint`
  3. `pnpm run check-types`
  4. `pnpm test` (Runs all 202 Vitest suites)
- **`quality.yml`**:
  1. `repository_health`: Monorepo hygiene validation.
  2. `typecheck`: TypeScript compilation check across all 12 projects.
  3. `dependency_cruiser`: Architectural boundary verification.
  4. `test_suites`: Vitest suite and API contract test verification.
  5. `doctor`: Master repository health report generation.

---

## 11. Developer Workflow & Fast Feedback Loops

Developers have dedicated commands for various testing workflows:
- `pnpm test`: Runs all unit, contract, and logic test suites in headless CI mode.
- `pnpm test:unit`: Runs fast unit and invariant suites.
- `pnpm test:contract`: Runs API schema and error contract validation.
- `pnpm test:integration`: Runs desktop SQLite integration suites via the Electron runtime.
- `pnpm test:watch`: Runs Vitest in interactive watch mode for instant TDD feedback.
- `pnpm test:coverage`: Generates code coverage reports using the V8 provider.

---

## 12. Invariant Preservation Verification Matrix

| Phase | Invariant Tested | Test Suite File | Verification Mechanism |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Monorepo Hygiene & Types | `check-types`, `quality.yml` | Turbo typecheck across all 12 monorepo packages. |
| **Phase 2** | Email Sanitization & Eligibility | `email-sanitizer.test.ts`, `outreach-eligibility.test.ts` | 42 sanitization edge cases; bounce, unsubscribe, exclusion policies. |
| **Phase 3** | DOM Crawler Extraction | `crawler-extractor.test.ts` | 12 DOM fixtures verifying mailto extraction, obfuscation decoding, honeypot rejection. |
| **Phase 4** | Campaign Lifecycle Safety | `campaign-lifecycle-safety.test.ts` | CAS transitions (`DRAFT` -> `ACTIVE` -> `PAUSED`), reservation idempotency, suppression. |
| **Phase 5** | Delivery Ledger & Engagement | `email-delivery-engagement.test.ts` | Reservation tokens, open tracking pixel, click redirect token HMAC validation. |
| **Phase 6** | Reply Reconciliation | `email-reply-reconciliation.test.ts` | Inbound Gmail reply parsing, thread matching, `REPLIED` contact transition, pause cascade. |
| **Phase 7** | Testing Infrastructure Modernization | Full Vitest Pipeline + Native Runner | 202 unit tests + 6 native integration suites executed deterministically. |

---

## 13. Known Limitations & Future Roadmap

1. **Email Logs UI (Phase 8)**: The user interface components for viewing email delivery ledgers and conversation threads are currently scheduled for Phase 8. Component testing with React Testing Library or Vitest Browser Mode will be integrated during that phase.
2. **End-to-End (E2E) Desktop Flow**: Full Electron application launch and UI automation via Playwright for Electron is planned as an overnight scheduled job rather than a PR blocking gate to preserve sub-minute CI turnaround times.
3. **AI Sentiment Ingestion Double**: A programmable mock for future LLM-based reply classification will be added to `@leadforge/core/test-utils` in upcoming intelligence phases.

---

## 14. Anti-Patterns & Enforcement Rules

To preserve testing health, the following anti-patterns are strictly forbidden:
- ❌ **Calling Real OAuth or External APIs**: Banned. Test doubles must be used.
- ❌ **Silent Error Swallowing**: Banned. Custom runners must never catch errors and print "SKIP" to mask native crashes.
- ❌ **Hardcoded Machine Paths**: Banned. Use `path.join(__dirname, ...)` or relative paths.
- ❌ **Random Delays (`sleep(2000)`)**: Banned. Use `vi.useFakeTimers()` or event-driven promises.
- ❌ **Direct Mutations Across Workspaces**: Banned. Queries must always include `workspaceId`.
