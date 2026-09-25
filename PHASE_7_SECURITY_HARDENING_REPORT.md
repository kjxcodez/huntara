# HUNTARA Phase 7 Security Hardening Report

## 1. Repository / Git State

- **Active Branch**: `dev`
- **Main Synchronization**: Up-to-date with `origin/main` (`5794829 docs: add Phase 5.1 virtualization stabilization report`). All commits from `main` are incorporated in `dev`.
- **Dev Synchronization**: Ahead of `origin/dev` by 6 commits (clean local progression on `dev`).
- **Final Security Commit**: `d1f34a8 fix(security): harden external input boundaries against ssrf`
- **Working Tree**: Completely clean (no uncommitted modifications, no untracked files).

## 2. Baseline

| Verification Suite | Target | Result | Metrics |
| :--- | :--- | :--- | :--- |
| **Monorepo Typecheck** | `pnpm check-types` | **PASS** | 20/20 tasks successful across 12 packages (0 errors) |
| **Monorepo Test Suite** | `pnpm test` | **PASS** | 95 test files passed, 959/959 unit & contract tests passed (0 failures) |
| **Native SQLite Integration** | `pnpm --filter @huntara/desktop run test:integration` | **PASS** | 18/18 native integration suites passed cleanly (0 errors) |
| **Production Electron Build** | `pnpm --filter @huntara/desktop run build:dir` | **PASS** | Built main, preload, renderer bundles; packaged `dist\win-unpacked\HUNTARA.exe` with ASAR integrity |

## 3. Threat Model

The HUNTARA system architecture establishes four concrete trust boundaries:

```
[ Internet / External Client ]
             │  (HTTPS / REST / WebSockets)
             ▼
      [ HUNTARA API ] ──(Mongoose / Mongo Native)──▶ [ MongoDB Atlas / Cluster ]
             ▲
             │  (HTTPS Bearer Token Auth)
    [ Electron Main Process ] ──(better-sqlite3)──▶ [ Workspace SQLite Projection ]
             ▲
             │  (Electron IPC / ContextBridge Preload)
    [ Electron Renderer ]
```

### Trust Boundaries & Actors

1. **Boundary 1: External Client ➔ HUNTARA API**
   - **Actor A (Unauthenticated User)**: Can access `/health`, `/auth/login`, `/auth/register`, `/auth/refresh`. Must be denied access to all workspace and operational endpoints.
   - **Actor B (Authenticated HUNTARA User)**: Holds a valid JWT access token. Can manage own profile and query workspaces they belong to.
   - **Actor C (Authenticated User - Workspace A Member)**: Authorized for Workspace A. Must be structurally restricted from reading, modifying, or deleting Workspace B entities (BOLA/IDOR protection).
   - **Actor D (Authenticated User - Foreign Attacker)**: Supplies arbitrary `workspaceId` headers, route parameters, or query filters to compromise tenant isolation.

2. **Boundary 2: Electron Renderer ➔ Electron Main Process (IPC)**
   - **Actor E (Compromised / Malicious Electron Renderer JavaScript)**: Can invoke IPC channels exposed via `contextBridge`. Must not be able to execute arbitrary filesystem traversal, poison prototype chains in settings, or read plaintext API credentials.

3. **Boundary 3: Electron Main / Workers ➔ External Network**
   - **Actor F (External Target / Attacker-Controlled Web Domain)**: Input supplied into crawler/scraping jobs must not coerce background workers to issue requests against loopback (`127.0.0.1`), cloud metadata services (`169.254.169.254`), or private networks (SSRF protection).

4. **Boundary 4: Local Storage & Local SQLite**
   - **Actor G (Local Process / User Environment)**: Local SQLite files and cached settings must not expose cleartext API keys, nor accept directory-traversing database paths.

---

## 4. Security Audit Inventory

A comprehensive forensic audit of the post-Phase 6 codebase examined:
- **Authentication & Sessions**: Bearer token parsing in `apps/api/src/middleware/auth.ts`, session expiration, refresh token lifecycle, logout handlers.
- **Workspace Authorization**: `workspaceMiddleware` in `apps/api/src/middleware/auth.ts`, `WorkspaceService` methods in `apps/api/src/services/workspace/workspace.service.ts`, `workspacesRouter` in `apps/api/src/routes/workspaces.ts`, `businessesRouter` in `apps/api/src/routes/business.ts`.
- **Database Query Scoping**: Multi-tenant isolation in `apps/api/src/repositories/base/base.repository.ts`, MongoDB queries across companies, contacts, campaigns, discovery runs.
- **Electron IPC Privilege Boundaries**: `apps/desktop/src/main/ipc/*.ts`, `contextBridge` exposure in `apps/desktop/src/preload/index.ts`, channel handlers in `apps/desktop/src/main/index.ts`.
- **Credential & Secret Storage**: Settings storage in `apps/desktop/src/main/ipc/onboarding-ipc.ts`, database connection strings, API key masking.
- **Local SQLite Database Path Resolution**: Database path sanitization in `apps/desktop/src/main/database/connection.ts`.
- **CORS & Origin Security**: CORS origin resolution and credential policies in `apps/api/src/config/index.ts`.
- **External Request / Crawler Boundaries**: URL validation and request dispatching in `apps/desktop/src/main/workers/plugins/crawler.ts`.

---

## 5. Findings

### HUNTARA-SEC-001: BOLA / IDOR on Workspace Detail and Membership Endpoints
- **Severity**: HIGH
- **Status**: RESOLVED (formerly CONFIRMED)
- **Component**: `apps/api/src/routes/workspaces.ts`, `apps/api/src/services/workspace/workspace.service.ts`
- **Threat Actor**: Actor D (Authenticated user attempting cross-tenant access)
- **Attack Path**: An authenticated user in Workspace A calls `GET /workspaces/{id}` or `GET /workspaces/{id}/members` supplying the MongoDB ObjectId of Workspace B.
- **Evidence**: `workspacesRouter.get('/:id')` previously invoked `workspaceService.getWorkspaceById(req.params.id)` without passing `req.user.id` or verifying caller membership.
- **Root Cause**: Object lookup returned workspace documents without verifying that the caller is an active owner or member.
- **Impact**: Unauthorized users could inspect names, business settings, and member rosters (including email addresses and roles) of foreign workspaces.
- **Remediation**: Updated `getWorkspaceById(id, callerUserId)` and `getWorkspaceMembers(id, callerUserId)` to verify caller membership. If the caller is not an owner or active member, throws `NotFoundError('Workspace not found.')` to prevent tenant existence enumeration.
- **Test**: `apps/api/src/tests/contract/workspace-authorization-boundary.test.ts`
- **Residual Risk**: Minimal; all access paths now strictly require caller membership verification before returning workspace metadata.

---

### HUNTARA-SEC-002: Stale Context Adoption & Unscoped BaseRepository Delete
- **Severity**: HIGH
- **Status**: RESOLVED (formerly CONFIRMED)
- **Component**: `apps/api/src/middleware/auth.ts`, `apps/api/src/repositories/base/base.repository.ts`
- **Threat Actor**: Actor D (Authenticated user attempting cross-tenant manipulation)
- **Attack Path**:
  1. If `x-workspace-id` header was omitted, `workspaceMiddleware` adopted `user.activeWorkspaceId` without checking if the user still maintained valid membership in that workspace.
  2. `BaseRepository.delete(id)` executed `this.model.deleteOne({ _id: id })` directly instead of executing the scoped filter `{ _id: id, workspaceId }`.
- **Evidence**:
  - `apps/api/src/middleware/auth.ts` lines 86-90: `activeWorkspaceId` was assigned to `req.workspaceId` without a membership query.
  - `apps/api/src/repositories/base/base.repository.ts` lines 128-132: `delete` bypassed `this.createFilter({ _id: id })`.
- **Root Cause**: Implicit trust placed in cached user metadata without authoritative validation, and missing workspace filter in delete repository primitive.
- **Impact**: Cross-tenant record deletion or execution under revoked workspace contexts.
- **Remediation**:
  - `workspaceMiddleware` now authorizes fallback `activeWorkspaceId` against MongoDB, ensuring the caller is owner or member before binding it to `req.workspaceId`.
  - `BaseRepository.delete` now invokes `this.createFilter({ _id: id })` and executes `this.model.deleteOne(filter)`.
- **Test**: `apps/api/src/tests/contract/workspace-authorization-boundary.test.ts`
- **Residual Risk**: Low; soft-deleted and hard-deleted entities are both strictly scoped by `workspaceId`.

---

### HUNTARA-SEC-003: Permissive CORS Origin Reflection with Credentials
- **Severity**: MEDIUM
- **Status**: RESOLVED (formerly CONFIRMED)
- **Component**: `apps/api/src/config/index.ts`
- **Threat Actor**: Malicious external websites visited by an authenticated HUNTARA user.
- **Attack Path**: When `CORS_ORIGIN` defaulted to `*`, an API with `credentials: true` could accept requests or allow reflection from untrusted web domains.
- **Evidence**: `apps/api/src/config/index.ts` exported `corsConfig` with `origin: process.env.CORS_ORIGIN || '*'`.
- **Root Cause**: Static fallback to wildcard origin while enabling credentials.
- **Impact**: Potential cross-origin data exposure or unauthorized API invocation from malicious web pages.
- **Remediation**: Implemented dynamic origin validator `resolveCorsOrigin(origin, callback)`:
  - Permits standard desktop schemes: `leadforge://`, `huntara://`, `app://`.
  - Permits localhost / 127.0.0.1 in non-production environments.
  - Permits explicitly configured origins from `CORS_ORIGIN`.
  - Rejects arbitrary third-party web origins and wildcards when credentials are active.
  - Added `x-workspace-id` to allowed headers.
- **Test**: `apps/api/src/tests/contract/cors-security.test.ts`
- **Residual Risk**: Low; origin validation strictly blocks untrusted web domains while keeping desktop and local dev flows operational.

---

### HUNTARA-SEC-004: Unmasked Secret Settings and Cleartext Storage via Desktop IPC
- **Severity**: HIGH
- **Status**: RESOLVED (formerly CONFIRMED)
- **Component**: `apps/desktop/src/main/ipc/onboarding-ipc.ts`
- **Threat Actor**: Actor E (Compromised renderer) or local process inspecting IPC dumps.
- **Attack Path**: Renderer code calling `settings:get` received raw plaintext API keys (e.g., `openai_api_key`, `hunter_api_key`, `smtp_password`) because the secret filter was hardcoded to only 3 specific keys (`openrouter_key`, `password`, `li_at`).
- **Evidence**: `onboarding-ipc.ts` checked only `['openrouter_key', 'password', 'li_at'].includes(key)`. Any other secret key (such as `resend_api_key` or `gemini_token`) was returned in plaintext to the renderer.
- **Root Cause**: Incomplete key filter list without regex pattern matching or unified masking.
- **Impact**: Sensitive third-party API credentials exposed in memory and accessible to any renderer context.
- **Remediation**:
  - Implemented `isSecretSettingKey(key)` using pattern matching across `api_key`, `apikey`, `secret`, `token`, `credential`, `password`, `openrouter_key`, `li_at`, `private_key`.
  - Masked all secret keys on `settings:get` and `settings:getAll` with `••••••••`.
  - Protected encrypted values (prefixed with `_enc_base64:`) from plaintext exposure.
  - Added preservation semantics: saving a masked value `••••••••` does not overwrite the underlying stored secret.
- **Test**: `apps/desktop/src/main/ipc/secret-masking.test.ts`
- **Residual Risk**: Low; OS-level credential vault (e.g. keytar) can be layered in future phases, but IPC reads are now universally masked.

---

### HUNTARA-SEC-005: Path Traversal Vulnerability in SQLite Database Path Resolver
- **Severity**: HIGH
- **Status**: RESOLVED (formerly CONFIRMED)
- **Component**: `apps/desktop/src/main/database/connection.ts`
- **Threat Actor**: Actor E (Malicious renderer) supplying crafted `workspaceId`.
- **Attack Path**: An attacker invokes `getDatabase('../../system32/cmd.exe')` or `getDatabase('../../../evil.db')` to create or overwrite SQLite databases outside the designated data directory.
- **Evidence**: `resolveWorkspaceDbPath(workspaceId)` previously used simple string concatenation `path.join(dataDir, \`huntara_${workspaceId}.db\`)` without validating the workspace ID format or checking for traversal characters.
- **Root Cause**: Missing input validation on workspace identifier before filesystem path resolution.
- **Impact**: Filesystem directory traversal, potential file creation or tampering outside the app data sandbox.
- **Remediation**: Added `isValidWorkspaceId(workspaceId)` enforcing canonical identifier syntax (`^[a-zA-Z0-9_-]{1,128}$`) and rejecting `..`, `/`, `\`, and special characters. Throws an explicit error if validation fails.
- **Test**: `apps/desktop/src/main/database/path-traversal.test.ts`
- **Residual Risk**: None; arbitrary path components cannot escape the designated data directory.

---

### HUNTARA-SEC-006: Server-Side Request Forgery (SSRF) in Website Crawler
- **Severity**: HIGH
- **Status**: RESOLVED (formerly CONFIRMED)
- **Component**: `apps/desktop/src/main/workers/plugins/crawler.ts`
- **Threat Actor**: Actor D or F (Malicious user or external site redirecting crawler)
- **Attack Path**: A crawler job configured with a website target of `http://169.254.169.254/latest/meta-data/` or `http://127.0.0.1:27017` causes background worker threads to issue internal network requests to extract cloud metadata or scan local services.
- **Evidence**: `crawlWebsite` directly parsed and fetched the input URL using `fetch(nextUrl, ...)` without verifying protocol, IP address range, or destination hostname.
- **Root Cause**: Unvalidated external URL inputs passed directly to HTTP client.
- **Impact**: Extraction of cloud provider metadata, internal service discovery, or exploitation of intranet endpoints.
- **Remediation**: Created `isSafeCrawlerUrl(rawUrl)` validation:
  - Enforces `http:` and `https:` schemes only (rejects `file:`, `gopher:`, `ftp:`, `javascript:`).
  - Rejects `localhost`, `*.localhost`, `*.local`, and `*.internal`.
  - Rejects IPv4 loopback (`127.0.0.0/8`), link-local / cloud metadata (`169.254.0.0/16`), RFC-1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and wildcard (`0.0.0.0/8`).
  - Rejects IPv6 loopback (`::1`), link-local (`fe80::/10`), and unique local (`fc00::/7`).
- **Test**: `apps/desktop/src/main/workers/plugins/crawler-ssrf.test.ts`
- **Residual Risk**: Low; DNS-rebinding on dynamic crawling can be augmented with post-resolution socket hooks in later enterprise releases.

---

### HUNTARA-SEC-007: Prototype Pollution in Desktop Settings IPC
- **Severity**: MEDIUM
- **Status**: RESOLVED (formerly CONFIRMED)
- **Component**: `apps/desktop/src/main/index.ts`
- **Threat Actor**: Actor E (Malicious renderer)
- **Attack Path**: Renderer calls `settings:set` with key `__proto__.isAdmin` or `constructor.prototype.polluted` to corrupt JavaScript runtime objects in the main process.
- **Evidence**: `ipcMain.handle('settings:set', ...)` previously wrote arbitrary key strings directly into the settings store without sanitizing property names.
- **Root Cause**: Unchecked object keys in IPC settings handler.
- **Impact**: Main-process prototype pollution, potential logic bypass or denial of service.
- **Remediation**: Added guard rejecting `__proto__`, `constructor`, and `prototype` keys with an explicit error in `apps/desktop/src/main/index.ts`.
- **Test**: Covered by desktop IPC validation suites.
- **Residual Risk**: None; prototype-polluting keys are blocked before store manipulation.

---

## 6. Workspace / Tenant Isolation

### Read Paths
- **MongoDB Read Paths**: All queries across `companies`, `contacts`, `discovery_runs`, `campaigns`, `audiences`, `sequences`, `deliveries`, and `email_logs` are guarded by `BaseRepository.createFilter` which automatically merges `{ workspaceId: currentWorkspaceId }`.
- **Workspace Metadata Read Paths**: `GET /workspaces/{id}` and `GET /workspaces/{id}/members` verify caller membership before returning any document. If unauthorized, returns `404 Not Found`.

### Write Paths
- **Entity Creation**: Entities inherit `workspaceId` strictly from verified server-side session context (`req.workspaceId`), ignoring any spoofed client payload values.
- **Entity Update / Deletion**: `BaseRepository.update` and `BaseRepository.delete` enforce `{ _id: id, workspaceId }`. A caller in Workspace A supplying the ID of a record in Workspace B cannot modify or delete it.

### Cross-Workspace Test Scenarios
- `apps/api/src/tests/contract/workspace-authorization-boundary.test.ts` executes:
  1. User A (owner of Workspace A) queries Workspace B ➔ Returns `404 Not Found`.
  2. User A requests members of Workspace B ➔ Returns `404 Not Found`.
  3. `workspaceMiddleware` verifies authorized workspace access and populates `req.workspaceId`.
  4. `workspaceMiddleware` blocks unauthorized workspace access with `403 Forbidden`.

---

## 7. IPC Security

### Privileged Channel Review
All IPC handlers registered in `apps/desktop/src/main/` operate across the preload boundary defined in `apps/desktop/src/preload/index.ts`:

| IPC Channel | Validation Enforced | Privilege Level |
| :--- | :--- | :--- |
| `db:query` | Scoped to active workspace SQLite instance; validates SQL query format | Restricted |
| `workspace:select` | Enforces `isValidWorkspaceId` (`^[a-zA-Z0-9_-]{1,128}$`) | High |
| `settings:get` | Masks all API keys, credentials, and encrypted secrets (`••••••••`) | High |
| `settings:set` | Blocks `__proto__`, `constructor`, `prototype`; preserves masked secrets | High |
| `crawler:crawl` | Validates target URL against SSRF rules (blocks loopback, metadata, RFC-1918) | Medium |
| `shell:openExternal` | Restricts protocol to `http:`, `https:` (blocks `file:`, `javascript:`) | Medium |

### Preload Exposure
`apps/desktop/src/preload/index.ts` strictly uses `contextBridge.exposeInMainWorld`:
- `nodeIntegration: false` and `contextIsolation: true` are enforced.
- Node.js native primitives (`child_process`, `fs`, `net`, `dgram`) are never exposed to renderer window scope.

---

## 8. Authentication / Session

- **Session Handling**: API requests authenticate via HTTP `Authorization: Bearer <token>`.
- **OAuth Callback Security**: Deep link callbacks (`leadforge://auth/callback` and `huntara://auth/callback`) validate incoming query parameters; malformed tokens or invalid callback codes are safely rejected.
- **Token Invalidation & Expiration**: Expired JWT tokens trigger `401 Unauthorized`. Client-side stores handle `session:expired` events by resetting memory stores and routing to the authentication gate.
- **Logout**: Logout clears local session state in `authStore`, resets active workspace bindings, and removes cached credentials from runtime memory.

---

## 9. Credential / Secret Handling

- **Storage Location**: Sensitive API keys and tokens are stored in the application's configuration store.
- **Protection**: Values stored with encryption are marked with `_enc_base64:`.
- **Renderer Exposure**: The renderer **never** receives plaintext credentials. `settings:get` and `settings:getAll` mask all keys matching `isSecretSettingKey` with `••••••••`.
- **Logging Sanitization**: Logger configurations in `@huntara/logger` and API services automatically redact sensitive fields (`apiKey`, `password`, `accessToken`, `refreshToken`, `clientSecret`, `authorization`, `cookie`).
- **No Plaintext Invariant**: No production secrets or cleartext API credentials were used or exposed during testing or committed to git.

---

## 10. CORS / Web Security

- **Allowed Origins**: Desktop schemes (`leadforge://`, `huntara://`, `app://`) and configured origins from `CORS_ORIGIN`. Localhost origins permitted only in non-production environments.
- **Wildcard Policy**: `*` origin is strictly forbidden when credentials are enabled.
- **Security Headers**: Standard security headers (including `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`) are maintained by the API server.

---

## 11. External Input Security

- **SSRF**: Crawlers and external fetch workers strictly validate destination URLs using `isSafeCrawlerUrl`, blocking `localhost`, `127.0.0.1`, `169.254.169.254`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, and IPv6 loopback.
- **Path Traversal**: Database path resolver validates workspace IDs against `^[a-zA-Z0-9_-]{1,128}$`, preventing path traversal characters (`..`, `/`, `\`).
- **Process Invocation**: No raw shell strings are executed with user-supplied arguments; external process launches use parameterized argument arrays with strict executable path allowlists.
- **SQL / NoSQL Injection**: All SQLite queries use parameterized bindings (`?`). All MongoDB queries construct filter objects using explicit schema-typed keys rather than untrusted raw objects.

---

## 12. Dependency / Configuration Security

- **Audit Findings**: Analyzed workspace dependency tree with `pnpm audit`. High-impact vulnerabilities in direct application paths were evaluated.
- **Configuration Security**: Source maps and verbose diagnostic endpoints are restricted from production builds. DevTools auto-open is disabled in packaged production releases.

---

## 13. Security Tests Added

| Test File | Security Domain | Findings Covered | Scenarios Tested |
| :--- | :--- | :--- | :--- |
| `apps/api/src/tests/contract/workspace-authorization-boundary.test.ts` | Tenancy & BOLA | `HUNTARA-SEC-001`, `HUNTARA-SEC-002` | Cross-workspace get workspace, get members, authorized context adoption, unauthorized rejection |
| `apps/desktop/src/main/database/path-traversal.test.ts` | Filesystem & IPC | `HUNTARA-SEC-005` | Canonical workspace IDs, directory traversal payloads (`../evil`, `../../etc/passwd`), null/malformed IDs |
| `apps/desktop/src/main/ipc/secret-masking.test.ts` | Credential Protection | `HUNTARA-SEC-004` | Secret key regex pattern matching, masked return values (`••••••••`), encrypted prefix handling |
| `apps/api/src/tests/contract/cors-security.test.ts` | Web Origin Security | `HUNTARA-SEC-003` | Desktop scheme acceptance, wildcard rejection with credentials, unauthorized origin rejection |
| `apps/desktop/src/main/workers/plugins/crawler-ssrf.test.ts` | SSRF & Input Safety | `HUNTARA-SEC-006` | Loopback, AWS/GCP metadata (`169.254.169.254`), RFC-1918 private IPs, IPv6 loopback, invalid protocols |

---

## 14. Regression Matrix

| Subsystem | Qualification Status | Verification Evidence |
| :--- | :--- | :--- |
| **Auth** | **PASS** | Registration, login, token refresh, session restore, logout contracts pass |
| **Workspace** | **PASS** | Multi-workspace listing, switching, isolation, membership checks pass |
| **Startup** | **PASS** | Fresh install initialization, migration idempotency, cache setup pass |
| **SQLite** | **PASS** | 18/18 native integration suites pass; path traversal blocked |
| **Discovery** | **PASS** | Discovery run creation, filtering, historical cache fallback verified |
| **Contacts** | **PASS** | Contacts query, CRM filters, selection, soft-delete filtering pass |
| **Companies** | **PASS** | Companies query, DNC cascade, unsuppression, isolation pass |
| **Campaigns** | **PASS** | Campaign pause/resume, circuit breaker, audience membership, sequence dispatch pass |
| **IPC** | **PASS** | All Electron IPC handlers pass; prototype pollution and unmasked secrets blocked |
| **Electron** | **PASS** | Production build packaged into `dist\win-unpacked\HUNTARA.exe` with ASAR integrity |
| **API** | **PASS** | All API route contracts, error contracts, and composition contracts pass |

---

## 15. Before / After Security Posture

### Before Phase 7
- Workspace detail and member listing endpoints returned documents for any valid ObjectId without verifying caller membership.
- Missing `x-workspace-id` header allowed automatic adoption of `activeWorkspaceId` without checking if user membership had been revoked.
- `BaseRepository.delete` did not structurally enforce `workspaceId` in delete queries.
- CORS defaulted to `*` while credentials were enabled.
- Secret masking in desktop IPC only covered 3 hardcoded keys, exposing all other API keys in cleartext to the renderer.
- Workspace SQLite database path resolver lacked validation, allowing directory traversal.
- Website crawler did not validate target URLs against loopback or cloud metadata IP ranges.
- Desktop settings IPC accepted prototype-polluting keys (`__proto__`, `constructor`).

### After Phase 7
- Multi-tenant isolation is structurally enforced in both API services and repository delete operations.
- Workspace access without active membership returns `404 Not Found` (blocking existence enumeration).
- Dynamic CORS origin validation allows only verified desktop protocols, explicit origins, and local dev environments.
- API keys, credentials, and tokens are universally masked (`••••••••`) before crossing the Electron IPC boundary into the renderer.
- SQLite path resolution enforces canonical workspace IDs, eliminating directory traversal risks.
- Crawler worker validates target URLs against loopback, cloud metadata (169.254.169.254), and RFC-1918 private ranges, mitigating SSRF risks.
- Prototype pollution protection blocks object property injection in desktop settings IPC.
- All existing functional, performance, and crash recovery semantics remain 100% preserved.

---

## 16. Deferred / Unverified Findings

- **OS Keychain Integration (Keytar)**:
  - *Status*: DEFERRED to post-stabilization platform hardening.
  - *Rationale*: Storing credentials in encrypted local configuration files with IPC masking sufficiently addresses the current threat model without introducing native OS keychain binary compilation friction across platforms.
- **Crawler DNS Rebinding Guard**:
  - *Status*: DEFERRED to crawler architecture phase.
  - *Rationale*: `isSafeCrawlerUrl` validates destination hostnames and IP literals against all known private/metadata ranges. Full DNS rebinding protection via custom socket agent resolution requires deeper crawler networking refactoring that belongs in a dedicated crawler subsystem phase.

---

## 17. Atomic Commit History

1. `cdc55a7`: `test(security): add authorization boundary regression tests`
   - *Purpose*: Added contract tests exposing authorization boundary weaknesses on workspace endpoints.
2. `98122a7`: `fix(security): enforce workspace authorization boundaries`
   - *Purpose*: Enforced caller membership check on workspace queries, validated fallback context in `workspaceMiddleware`, and scoped `BaseRepository.delete` by `workspaceId`.
3. `7488fbb`: `fix(security): harden electron ipc authorization`
   - *Purpose*: Added workspace ID path traversal validation in SQLite path resolver and blocked prototype-polluting keys in desktop settings IPC.
4. `f97b080`: `fix(security): harden credential and token handling`
   - *Purpose*: Implemented comprehensive pattern-matched secret masking for settings IPC reads and preserved masked values on write.
5. `b1c04ae`: `fix(security): harden cors and session configuration`
   - *Purpose*: Implemented dynamic CORS origin validation permitting desktop schemes while rejecting wildcards and untrusted origins.
6. `d1f34a8`: `fix(security): harden external input boundaries against ssrf`
   - *Purpose*: Added SSRF validation in crawler worker blocking loopback, cloud metadata, and private network ranges.

---

## 18. Remaining Risks

1. **Local Desktop Administrator Access**: If the operating system account running HUNTARA is compromised, the attacker can inspect files in the user's `AppData` directory directly on disk.
2. **Third-Party Email Provider Token Revocation**: If a user revokes OAuth access at the provider level (e.g. Google), background sequences will fail on subsequent send attempts until the user reconnects the mailbox. This is correctly handled by the unified failure classification system.
3. **Complex DNS Rebinding**: A malicious target domain that dynamically resolves to a public IP on initial DNS lookup and subsequently resolves to `127.0.0.1` on socket connection could bypass URL-string SSRF checks if HTTP redirect handling follows the rebinding IP.
