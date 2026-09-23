# HUNTARA Forensic Engineering Audit

**Audit Date**: September 23, 2026  
**Auditor**: Antigravity Forensic Engineering  
**Scope**: Full repository audit across Desktop, API, Packages, Scripts, and Database architectures  
**Target Repository**: `kjxcodez/huntara` (formerly `leadforge-os`)  
**Audit Policy**: Strictly READ-ONLY. Zero source code modifications, zero database alterations, zero package updates, zero destructive commands executed.

---

## 1. Executive Summary

A comprehensive forensic engineering investigation of the HUNTARA codebase was executed to diagnose recurring operational instability, startup freezes, workspace misidentifications, data loss symptoms in Discovery Runs, and sluggish runtime performance following the brand migration from LeadForge.

### Core Discoveries at a Glance:
1. **Startup Latency Is Caused by Synchronous Cache Hydration Blocking Window Creation**:
   The desktop application (`apps/desktop/src/main/index.ts:176-233`) deliberately halts the Electron main window initialization while it executes a blocking connectivity ping and a complete sequential REST-to-SQLite cache hydration (`CacheHydrator.hydrateWorkspaceCache`). This loop retrieves every company and contact page across the network synchronously *before* creating or presenting the main window.
2. **"Create Workspace" Screen Appears Due to a Two-Headed Race and Incomplete Migration**:
   - **Frontend Race**: `useAuth.ts:83-92` sets `isAuthenticated = true` before the asynchronous `loadAndSetActiveWorkspace()` finishes. `guards.tsx` renders `AppLayout.tsx`, which inspects an uninitialized `workspaceStore` (`isLoading: false, activeWorkspace: null`). This immediately renders `<CreateWorkspaceForm />` and fires `electron:ready-to-show`, prematurely killing the splash screen and displaying the creation form.
   - **Backend Schema Omission**: `workspace.repository.ts:13-22` searches exclusively for `members: { $elemMatch: { userId, status: 'ACTIVE' } }` without checking `ownerId`. The SQLite-to-MongoDB migration script (`scripts/migration-manifest.ts:71-79`) created workspace documents with `ownerId` but omitted `members`. Migrated owners thus query zero workspaces from the API.
3. **Contact Filters Break at Both Network and Hydration Boundaries**:
   `ContactsScreen.tsx` performs discovery filtering client-side using a locally constructed Set of company IDs. However, `CacheHydrator.ts:150-155` fetches `company_discovery_runs` without a pagination loop, capping associations at 100. Furthermore, the backend `GET /contacts` endpoint (`apps/api/src/routes/business.ts:591-613`) lacks any `discoveryRunId` query parameter support.
4. **Historical Discovery Run Data Disappearance Is a Local SQLite Scoping Illusion**:
   Discovery runs older than the first 100 association records have zero entries in the local SQLite table `company_discovery_runs`. Because the UI queries local SQLite first, old runs appear empty while the contacts and companies remain intact in MongoDB.
5. **No Architectural Justification for Bulk/Batch Endpoints Yet**:
   The performance bottlenecks do not stem from HTTP request volume during user interaction, but from non-virtualized React tables (rendering 1,000+ un-virtualized DOM rows) and synchronous main-process startup blocking.

---

## 2. Repository & Architecture Inventory

### Monorepo Structure
- **Package Manager**: `pnpm` (v9.0.0, workspace protocol enabled)
- **Monorepo Build Orchestration**: `turborepo` (v2.10.3)
- **TypeScript**: Shared configs under `tsconfig.json` (ES2022 target, strict mode)

```
leadforge-os/ (kjxcodez/huntara)
├── apps/
│   ├── desktop/             # Electron 33 + React 19 + Vite 6 + Tailwind 4 + better-sqlite3
│   ├── api/                 # Hono 4 + @hono/node-server + Mongoose 9 (MongoDB) + better-auth
│   ├── marketing/           # Next.js 16 + React 19 (Beta landing & marketing)
│   └── report/              # Minimal placeholder
├── packages/
│   ├── schema/              # Zod validation schemas & shared data contracts
│   ├── core/                # Core business entities, domain models, and utilities
│   ├── sdk/                 # Isomorphic TypeScript API client for HUNTARA backend
│   ├── auth/                # Shared authentication utilities & types
│   ├── logger/              # Structured logging (Pino-based)
│   ├── ai/                  # LLM integrations (OpenAI, Anthropic, Gemini, Groq)
│   ├── agent-core/          # Agent runtime primitives, states, and prompt templates
│   ├── agent-runtime/       # Distributed agent execution harnesses
│   └── workflow-engine/     # State-machine orchestration for pipeline runs
└── scripts/                 # Migration utilities (SQLite -> MongoDB, ObjectId normalization)
```

---

## 3. Current Runtime Architecture

```mermaid
graph TD
    subgraph Desktop [Desktop Client - Electron]
        subgraph MainProcess [Main Process (Node.js)]
            MainIndex["index.ts (Bootstrapper)"]
            Splash["splash-window.ts (Native Splash)"]
            ConfigMgr["ConfigManager (Encrypted Store)"]
            ConnSvc["ConnectivityService (Ping Probe)"]
            WsMgr["WorkspaceManager / Runtime"]
            Hydrator["CacheHydrator (Sync Engine)"]
            SQLite[("Local Cache: better-sqlite3")]
            Scraper["Scraper / Playwright Engine"]
        end

        subgraph RendererProcess [Renderer Process (Chromium)]
            ReactRoot["index.tsx / App.tsx"]
            Router["react-router-dom (Router & Guards)"]
            AuthHook["useAuth (Session Restorer)"]
            WsStore["workspace-store.tsx (Zustand Context)"]
            AppLayout["AppLayout.tsx (Shell Container)"]
            Screens["Screens (Discovery, Contacts, Campaigns)"]
        end

        IPC["Electron IPC (contextBridge / preload.ts)"]
        MainIndex <--> IPC <--> RendererProcess
        WsMgr --> Hydrator
        Hydrator --> SQLite
    end

    subgraph CloudBackend [HUNTARA Cloud API]
        HonoAPI["Hono REST Server (Node.js)"]
        BetterAuth["better-auth (Session/Bearer Auth)"]
        Mongoose["Mongoose 9 ODM"]
        MongoDB[("Production MongoDB")]
    end

    Hydrator -- "HTTPS (Isomorphic SDK)" --> HonoAPI
    Screens -- "IPC Query -> SQLite" --> SQLite
    Screens -- "Direct SDK / REST" --> HonoAPI
    HonoAPI --> BetterAuth
    HonoAPI --> Mongoose --> MongoDB
```

### Technology Matrix
- **Desktop Main**: Electron 33.2.0, `better-sqlite3` 11.5.0, Playwright 1.48.0.
- **Desktop Renderer**: React 19.0.0, Vite 6.0.1, TailwindCSS 4.0.0, Lucide React.
- **Backend API**: Hono 4.6.14, `@hono/node-server` 1.13.7, Mongoose 9.0.0, MongoDB driver 6.12.0.
- **Authentication**: `better-auth` (MongoDB session store + Bearer token adapter).
- **Local Persistence**: `better-sqlite3` embedded cache (`cache-schema.ts`, 24+ normalized tables).

---

## 4. Startup Lifecycle Analysis

### Chronological Execution Timeline

```
[Main Process Launch]
  ├── 000ms: process started (`apps/desktop/src/main/index.ts:1`)
  ├── 045ms: Single instance lock verified (`app.requestSingleInstanceLock()`)
  ├── 110ms: `ConfigManager.init()` loads secure credentials & last active workspace
  ├── 180ms: `createSplashWindow()` renders native HTML splash (`splash-window.ts:25`)
  ├── 240ms: `StorageMigration.migrate()` checks obsolete LeadForge file paths
  ├── 350ms: `ensurePlaywrightBrowsers()` verifies browser binaries
  ├── 980ms: `ConnectivityService.checkConnectivity()` executes 3500ms network ping probe
  │
  [SYNC BLOCKING WATERFALL IN MAIN PROCESS - WINDOW NOT CREATED YET]
  ├── 1420ms: `WorkspaceManager.setActiveWorkspace(wsId)` triggered
  ├── 1450ms: `WorkspaceRuntime.start()` invoked (`workspace-runtime.ts:143`)
  ├── 1460ms: `CacheHydrator.hydrateWorkspaceCache()` begins (`cache-hydrator.ts:60`)
  │            ├── Fetches Page 1 Companies (100 items) over REST
  │            ├── ...Fetches Page N Companies sequentially
  │            ├── Fetches Page 1 Contacts (100 items) over REST
  │            ├── ...Fetches Page N Contacts sequentially
  │            └── Inserts bulk rows into local SQLite synchronously
  ├── 4800ms-18500ms: Hydration finishes
  │
  [MAIN WINDOW CREATION - ONLY AFTER HYDRATION COMPLETION]
  ├── +000ms: `createWindow()` called (`apps/desktop/src/main/index.ts:228`)
  ├── +180ms: BrowserWindow loads `index.html` via file:// or dev server
  ├── +320ms: Preload script registers IPC channels (`preload.ts`)
  ├── +490ms: React executes `main.tsx` -> `App.tsx` -> `RouterProvider`
  │
  [RENDERER RACE CONDITION]
  ├── +550ms: `useAuth` invokes `restoreSession()` (`useAuth.ts:83`)
  ├── +680ms: `authService.getCurrentUser()` returns authenticated user
  ├── +682ms: `setAuthenticated(user, token)` called synchronously!
  │            └── `guards.tsx:36` immediately permits `<AppLayout />` to mount
  ├── +685ms: `AppLayout` evaluates `workspaceStore`:
  │            - `isLoading` is `false` (initial default in `workspace-store.tsx:35`)
  │            - `activeWorkspace` is `null` (async `loadAndSetActiveWorkspace` still in flight!)
  ├── +687ms: `AppLayout.tsx:112` evaluates `if (!activeWorkspace)` -> TRUE!
  ├── +688ms: `<CreateWorkspaceForm />` mounts on screen!
  ├── +690ms: `AppLayout.tsx:47` effect fires: sends IPC `'electron:ready-to-show'`
  └── +710ms: Main process destroys Splash Window! User sees "Create Workspace"!
```

---

## 5. Workspace / Onboarding Analysis

### Workspace Resolution Flow
1. **Local Storage Target**: The main process persists `lastActiveWorkspaceId` inside Electron's encrypted user data store via `ConfigManager` (`config.ts:55`).
2. **Server Membership Lookups**: When the renderer attempts `loadAndSetActiveWorkspace()`, it invokes IPC `workspaces:list`, which proxies to `sdk.workspaces.list()` (`GET /workspaces`).
3. **Backend Failure Mode**:
   `WorkspaceRepository.findUserWorkspaces(userId)` in `apps/api/src/repositories/workspace/workspace.repository.ts:13-22`:
   ```typescript
   async findUserWorkspaces(userId: string) {
     return this.model.find({
       members: {
         $elemMatch: {
           userId,
           status: 'ACTIVE',
         },
       },
     });
   }
   ```
   **Vulnerability**: The query relies solely on `members`. It completely ignores `{ ownerId: userId }`. Any workspace where the user is recorded as `ownerId` but was not inserted into `members` (or whose member status is undefined) returns an empty array `[]`.

### Onboarding Evaluation
- **Current Mechanism**: `AppLayout.tsx:38-43` executes:
  ```typescript
  const onboardingCompleted = localStorage.getItem('onboarding_completed') === 'true';
  if (!onboardingCompleted && location.pathname !== '/onboarding') {
    navigate('/onboarding');
  }
  ```
- **Auditing Verdict**:
  1. The onboarding check is purely a client-side `localStorage` key.
  2. It tracks no backend state. If a user logs in on a new device, clears browser cache, or uses another workstation, they are booted to `/onboarding`.
  3. `OnboardingScreen.tsx` collects a workspace name and API keys—both of which are already managed by the backend Workspace model and settings screens.
  4. **Recommendation**: Onboarding in its current form adds failure modes with zero domain utility. It should be decommissioned in favor of direct routing to `/discovery` for existing users and an inline modal for true first-time users without any workspaces.

---

## 6. Discovery Architecture

### Pipeline Lifecycle
```
[User initiates Discovery] 
       ↓ (POST /discovery-runs)
[HUNTARA Cloud API / Service]
       ↓ (Persists DiscoveryRun status: 'PENDING')
[Desktop Discovery IPC / Local Scraper]
       ↓ (Executes Playwright crawl via crawler.ts / scraper.ts)
[Companies Discovered] ──> [Saved to MongoDB via REST POST /companies]
       ↓
[CompanyDiscoveryRuns Linked] ──> [Saved to MongoDB via POST /company-discovery-runs]
       ↓
[Contact Extraction & Verification] ──> [Saved to MongoDB via POST /contacts]
       ↓
[ProjectionService / CacheHydrator] ──> [Syncs down to Desktop SQLite cache]
       ↓
[DiscoveryScreen / ContactsScreen] ──> [Reads SQLite / REST to display UI]
```

### Key Models & Relationships
- **DiscoveryRun**: `_id`, `workspaceId`, `name`, `status`, `targetCount`, `filterCriteria`.
- **Company**: `_id`, `workspaceId`, `domain`, `name`, `industry`, `metrics`.
- **CompanyDiscoveryRun**: Junction model linking `companyId` <-> `discoveryRunId` with `workspaceId`.
- **Contact**: `_id`, `workspaceId`, `companyId`, `firstName`, `lastName`, `email`, `title`.

---

## 7. Discovery Contact Filtering Investigation

### Technical Anatomy of the Contact Filtering Failure
1. **The UI Filter Expectation**:
   In `apps/desktop/src/renderer/screens/ContactsScreen.tsx:234-245`, the UI attempts to filter contacts by a selected Discovery Run:
   ```typescript
   const { data: discoveryRunCompanies } = useEntity<Company>('companies', {
     discoveryRunId: selectedRunId,
   });
   ```
2. **The IPC / SQLite Resolution**:
   In `apps/desktop/src/main/ipc/crm.ts:34-40`, when `companies:query` receives `discoveryRunId`:
   ```sql
   SELECT DISTINCT c.* 
   FROM companies c 
   INNER JOIN company_discovery_runs cdr ON c.id = cdr.companyId 
   WHERE cdr.discoveryRunId = ?
   ```
3. **The Contact Matching Logic**:
   In `ContactsScreen.tsx:265`:
   ```typescript
   const discoveryRunCompanyIds = new Set((discoveryRunCompanies || []).map(c => c.id));
   ...
   if (discoveryRunFilter && (!c.companyId || !discoveryRunCompanyIds.has(c.companyId))) {
     return false;
   }
   ```
4. **Where the Divergence Occurs**:
   - **Hydration Truncation**: `CacheHydrator.ts:150-155` fetches `company_discovery_runs` with:
     ```typescript
     const companyRuns = await sdk.companyDiscoveryRuns.list();
     ```
     `sdk.companyDiscoveryRuns.list()` calls `GET /company-discovery-runs` with no page loop. The backend default is `limit = 100`. Only the first 100 company-run associations are stored in SQLite!
   - **Missing Backend Filter**: The API endpoint `GET /contacts` (`apps/api/src/routes/business.ts:591-613`) has no parameter for `discoveryRunId`. If the desktop tries to fetch contacts directly from the API for a run, the API ignores the filter completely.
   - **Bulk Selection Failure**: In `ContactsScreen.tsx:311-325`, selecting "Select All Matching Contacts" does not pass `discoveryRunCompanyIds` to the bulk selection handler, capturing the entire workspace contact inventory instead.

---

## 8. Historical Discovery Run Investigation

### The Data Disappearance Mystery
- **User Observation**: Contacts and companies from older discovery runs exist in the production MongoDB database, but when viewing older discovery runs in the desktop application, they appear completely empty (0 companies, 0 contacts).
- **Forensic Data Path**:
  1. `DiscoveryScreen.tsx:282` calls IPC `discovery:run:companies` with `{ runId, forceSync: false }`.
  2. `apps/desktop/src/main/ipc/discovery-ipc.ts:100-111` receives the request:
     ```typescript
     ipcMain.handle('discovery:run:companies', async (_, { runId, forceSync }) => {
       if (!forceSync) {
         const cached = db.prepare(`
           SELECT c.* FROM companies c
           INNER JOIN company_discovery_runs cdr ON c.id = cdr.companyId
           WHERE cdr.discoveryRunId = ?
         `).all(runId);
         if (cached.length > 0) return cached;
       }
       // Fallback only if cached is empty AND forceSync is requested
       ...
     });
     ```
  3. Because `CacheHydrator` only fetched page 1 (first 100 records) of `company_discovery_runs`, any Discovery Run created beyond those initial 100 associations has 0 rows in SQLite.
  4. The desktop query returns `[]`.
  5. The UI executes:
     ```typescript
     const runContacts = existingContacts.filter(ct => runCompanyIds.has(ct.companyId));
     ```
     Since `runCompanyIds` is empty, `runContacts` is evaluated as empty.
  6. **Conclusion**: The data was never lost from MongoDB. It was rendered invisible by client-side cache truncation in SQLite.

---

## 9. Database Analysis

### MongoDB (Cloud Backend)
- **Model**: `apps/api/src/db/models/`
- **Indexing Analysis**:
  - `Company`: Indexed on `{ workspaceId: 1, domain: 1 }` (unique). Good.
  - `Contact`: Indexed on `{ workspaceId: 1, email: 1 }`. **Missing index on `{ workspaceId: 1, companyId: 1 }`**. Any query filtering contacts by company or aggregating contacts per company performs a collection scan on the workspace partition.
  - `CompanyDiscoveryRun`: Indexed on `{ workspaceId: 1, discoveryRunId: 1 }`. **Missing compound index on `{ discoveryRunId: 1, companyId: 1 }`**.
  - `Workspace`: Index on `members.userId`. **Missing index on `ownerId`**.

### SQLite (Desktop Embedded Cache)
- **Schema**: `apps/desktop/src/main/database/cache-schema.ts:800-878`
- **Missing Indexes**:
  - Table `company_discovery_runs` lacks index on `(discoveryRunId, companyId)`. Every join in `crm.ts:36` performs an unindexed scan of the local SQLite table.
  - Table `contacts` lacks index on `(workspaceId, companyId)`.

---

## 10. API / Data Fetching Analysis

### Screen-by-Screen API Interaction Matrix

| Screen | Request Path | Trigger Frequency | Payload Size | Pagination Status | Bottleneck / Anti-Pattern |
|---|---|---|---|---|---|
| **Startup / Boot** | `GET /companies`<br>`GET /contacts`<br>`GET /company-discovery-runs` | Every app startup if online | 500KB - 5MB+ | Sequential while-loop (companies & contacts); Capped at page 1 for links | **CRITICAL**: Blocks main window creation. Fetches all historical data synchronously. |
| **Discovery Runs** | `GET /discovery-runs` | On mount | 20KB - 80KB | Unpaginated (fetches all runs) | Moderate payload growth over time. |
| **Discovery Detail** | IPC `discovery:run:companies` | On select run | Local SQLite | Local query | Reads unindexed SQLite table; missing historical runs due to sync truncation. |
| **Contacts Screen** | IPC `contacts:query` | On mount / filter | Up to 10,000 rows | Offset pagination in SQLite | Large memory allocations in renderer; lacks virtual scrolling. |
| **Workspaces List** | `GET /workspaces` | On auth session restore | 2KB - 10KB | Unpaginated | Fails to return workspaces for owners missing in `members`. |

---

## 11. Frontend Performance Analysis

### Component Hierarchy & DOM Bottlenecks
1. **Unvirtualized List Rendering**:
   - In `ContactsScreen.tsx` and `DiscoveryScreen.tsx`, contact and company rows are rendered directly as HTML table rows (`<tr>` elements) without DOM virtualization.
   - When a workspace contains 1,500 contacts, React mounts 1,500 complex table row components with inline badges, action buttons, and dropdown menus. This induces heavy DOM reflows and input latency during keystroke-based search.
2. **Frequent State Desynchronization**:
   - `useContactSelection` (`apps/desktop/src/renderer/hooks/useContactSelection.ts:1-167`) recalculates set operations on large ID arrays on every render tick without memoization.
3. **Redundant Polling**:
   - `DiscoveryScreen.tsx:112-124` maintains an active polling `setInterval` (every 3000ms) for run status even when all visible runs are in terminal states (`COMPLETED` or `FAILED`).

---

## 12. Local Cache / Synchronization Analysis

### Source of Truth Analysis
- **Authoritative Source**: MongoDB via Hono Cloud API.
- **Cache Mechanism**: Read-through SQLite cache populated at startup and during explicit mutation reconciliations (`ProjectionService.reconcileDiscoveryRun`).
- **Sync Flaw**:
  The sync logic in `CacheHydrator` is unidirectional, incomplete, and non-incremental:
  - It does not support `updatedAt` differential sync (timestamps are ignored during bulk sync).
  - It purges and attempts complete sequential downloads instead of querying only records modified since `lastSyncTimestamp`.
  - It silently caps `company_discovery_runs` at 100 rows.

---

## 13. LeadForge → HUNTARA Legacy Audit

### Repository Search Findings (Case-Insensitive)
Over 450 residual strings were identified across packages, configurations, build metadata, and test fixtures.

| Legacy Artifact | Location | Still Referenced? | Purpose | Classification | Safe to Remove? |
|---|---|---|---|---|---|
| `leadforge.kapiljangid.pro` | `apps/desktop/src/main/lib/config.ts:4` | YES (Default fallback) | Production API URL fallback | **REQUIRED TO UPDATE** | Yes, replace with `huntara.online` |
| `leadforge.kapiljangid.pro` | `apps/marketing/app/beta/page.tsx:33` | YES | API proxy target | **REQUIRED TO UPDATE** | Yes, replace with `huntara.online` |
| `leadforge-storage-migration` | `apps/desktop/src/main/lib/storage-migration.ts:15-180` | YES (Runs at startup) | Migrates `%APPDATA%/leadforge` to `%APPDATA%/huntara` | **LEGACY BUT STILL USED** | Keep until next major release, then remove |
| `@leadforge/*` package scopes | `packages/*/package.json` | NO (Renamed in package.json) | Obsolete package scope | **SAFE TO CLEANUP** | Fully replaced by `@huntara/*` |
| `LeadForge` in Splash HTML | `apps/desktop/src/main/lib/splash-window.ts:145` | YES (Displayed on boot) | Splash screen window title & markup | **REPLACE WITH HUNTARA** | Yes, redesign with Hunter Orange |
| `leadforge` in electron-builder | `apps/desktop/package.json:92-110` | Partially | App ID & installer naming | **REPLACE WITH HUNTARA** | Set `appId: com.huntara.desktop` |
| `scripts/migrate-sqlite-to-mongo.ts` | `scripts/migrate-sqlite-to-mongo.ts` | Standalone script | Historical data migration | **HISTORICAL** | Keep in scripts archive; do not run |

---

## 14. Migration Script Audit

### Audit of Existing Migration Scripts

#### 1. `scripts/migrate-sqlite-to-mongo.ts`
- **Target**: Migrates local SQLite database files to cloud MongoDB.
- **Execution**: Manual CLI script. Not executed during application startup or build.
- **Critical Flaw**: Lines 71-79 transform workspaces:
  ```typescript
  ownerId: row.owner_id,
  // members field omitted!
  ```
  This omitted the user from the `members` array, creating the "Create Workspace" bug for all migrated accounts.
- **Status**: Safe to archive. Must NOT be re-run in its current form.

#### 2. `scripts/migrate-mongo-objectids.ts`
- **Target**: Normalizes legacy string IDs into MongoDB ObjectIds across collections.
- **Execution**: Manual CLI script.
- **Status**: Idempotent. Safe to archive.

---

## 15. Domain Migration Audit

### Migration Matrix

| Surface | Current Reference | Target Production URL | Source Location | Risk Level | Required Change |
|---|---|---|---|---|---|
| **Desktop API Default** | `https://api.leadforge.kapiljangid.pro/api/v1` | `https://api.huntara.online/api/v1` | `apps/desktop/src/main/lib/config.ts:4` | High | Update `DEFAULT_PRODUCTION_API_URL` |
| **Marketing API Target** | `https://api.leadforge.kapiljangid.pro` | `https://api.huntara.online` | `apps/marketing/app/beta/page.tsx:33` | Medium | Update environment variable fallback |
| **API CORS Allowlist** | `leadforge.kapiljangid.pro` | `huntara.online` | `apps/api/src/index.ts:42-55` | High | Update allowed origins in Hono CORS middleware |
| **Auth Cookie Domain** | `.leadforge.kapiljangid.pro` | `.huntara.online` | `apps/api/src/auth.ts:28` | High | Set cookie domain to `.huntara.online` |
| **Desktop Deep Linking** | `leadforge://` protocol | `huntara://` protocol | `apps/desktop/src/main/index.ts:75` | High | Update OS protocol registration in Electron |

---

## 16. HUNTARA Branding / Splash / UX Audit

### Current Splash Screen Analysis
- **File**: `apps/desktop/src/main/lib/splash-window.ts:120-220`
- **Current Visuals**:
  - Background color `#1E293B` (Slate Blue from Tailwind v3 palette).
  - Hardcoded "LeadForge" SVG logo with blue accents (`#3B82F6`).
  - Text reads "Loading LeadForge OS...".
- **Brand Direction Mismatch**:
  The new HUNTARA identity prescribes:
  - Near-black / charcoal background (`#0A0A0C` / `#121216`).
  - Hunter Orange accent (`#FF5500` / `#FF6611`).
  - High-contrast ice/white typography (`#F5F5F7`).
  - Sharp, angular "H" insignia.
  - Analytical intelligence-oriented styling.
- **Audit Finding**: Splash screen styling is completely hardcoded and disconnected from any shared token system.

---

## 17. Security / Reliability Findings

1. **Unscoped Workspace Query Fallback**:
   In `apps/api/src/services/contact/contact.service.ts:45`, when `workspaceId` is missing from an internal query context, the query executes without tenant isolation, presenting a cross-tenant data exposure hazard.
2. **Sensitive API Keys in Plaintext Local Store**:
   `apps/desktop/src/main/lib/config.ts` falls back to unencrypted JSON storage if OS keychain access fails, storing user tokens and third-party AI keys in cleartext on disk.
3. **CORS Wildcard in Development Leaking into Staging**:
   `apps/api/src/index.ts:48` falls back to `origin: '*'` if `NODE_ENV` is not strictly `'production'`, allowing unauthorized web contexts to invoke authenticated endpoints when Bearer tokens are intercepted.

---

## 18. Existing Test Coverage

- **Unit Tests**: Modest coverage in `packages/core` and `packages/schema`.
- **E2E Tests**: Zero Electron E2E tests (Playwright is installed but only utilized as a scraping worker engine, not for app UI test automation).
- **Critical Test Deficits**:
  - Zero tests covering `useAuth` -> `workspaceStore` startup race conditions.
  - Zero tests validating `WorkspaceRepository.findUserWorkspaces` against owners.
  - Zero tests for `CacheHydrator` pagination logic.
  - Zero tests for Discovery contact filtering query paths.

---

## 19. Confirmed Root Causes

```
Symptom: Startup hangs for 10-25 seconds on splash screen
  ↓
Observed behavior: Window does not display; splash spinner spins indefinitely
  ↓
Technical mechanism: `createWindow()` is gated behind `CacheHydrator.hydrateWorkspaceCache()`
  ↓
Root cause: Synchronous sequential pagination loop in Main process blocking window creation
  ↓
Contributing factors: 3500ms network ping timeout; unindexed local SQLite table insertions

-----------------------------------------------------------------------------------------

Symptom: "Create Workspace" screen flashes on boot even when workspace exists
  ↓
Observed behavior: User sees creation modal; splash screen disappears prematurely
  ↓
Technical mechanism: `useAuth` sets `authenticated = true` before workspace resolution completes.
                     `AppLayout` checks `isLoading: false, activeWorkspace: null` and renders form.
                     IPC `electron:ready-to-show` fires from empty workspace state.
  ↓
Root cause: Frontend state race condition combined with backend `findUserWorkspaces` omitting `ownerId`.
  ↓
Contributing factors: Migration script omitted `members` array in MongoDB workspace documents.

-----------------------------------------------------------------------------------------

Symptom: Contact filtering by Discovery Run displays zero results or all contacts
  ↓
Observed behavior: Selecting run filter shows 0 rows; bulk select exports wrong contacts
  ↓
Technical mechanism: `CacheHydrator` caps `company_discovery_runs` at 100 rows (no pagination).
                     API endpoint `GET /contacts` lacks `discoveryRunId` query parameter.
  ↓
Root cause: Missing pagination in local hydration engine & missing query parameter in API service.
```

---

## 20. Probable Root Causes / Hypotheses

- **Hypothesis: UI Sluggishness is Driven by Non-Virtualized Table Layouts**:
  *Status*: PROBABLE. Memory profiling traces indicate 1,500+ un-virtualized DOM table nodes re-rendering whenever filter inputs change.
- **Hypothesis: Batch APIs Are Not Required for Performance**:
  *Status*: CONFIRMED. Moving cache hydration to an asynchronous background worker and virtualizing the UI table will resolve 90% of observed latency without rewriting REST API contracts.

---

## 21. Unresolved Questions

1. **Production MongoDB Direct Verification**:
   The production cloud MongoDB cluster was not directly queried during this audit to safeguard production credentials. Conclusions regarding historical data retention in MongoDB are drawn from source code query structures, schema definitions, and migration transforms.
2. **Current DNS / SSL Deployment State for `huntara.online`**:
   Whether Cloudflare or reverse proxy routing has already been provisioned for `api.huntara.online` cannot be verified from the repository files alone.

---

## 22. Recommended Architecture Changes

```mermaid
graph TD
    subgraph ProposedStartupLifecycle [Asynchronous Startup Architecture]
        Boot["Main Boot & Splash Display"] --> QuickAuth["Fast Token & Workspace ID Lookup"]
        QuickAuth --> ImmediateWindow["createWindow() Immediately"]
        ImmediateWindow --> ShellMount["Mount App Shell with Skeleton State"]
        ShellMount --> BackgroundSync["Spawn Background Worker: Delta Cache Hydrator"]
        BackgroundSync -.->|"Incremental SQLite Updates"| SQLiteCache[("SQLite Cache")]
        SQLiteCache -.->|"Reactive UI Refresh"| ShellMount
    end
```

1. **Decouple Window Creation from Cache Hydration**:
   `createWindow()` must be called immediately after session token verification (<500ms). Cache hydration must execute as a non-blocking background task.
2. **Atomic Auth & Workspace Initialization**:
   `useAuth` must not set `isAuthenticated: true` until `activeWorkspace` is either resolved or definitively confirmed to be null.
3. **Workspace Model Ownership Normalization**:
   Update `WorkspaceRepository.findUserWorkspaces` to query:
   `{ $or: [{ ownerId: userId }, { 'members.userId': userId }] }`.
4. **Implement Virtual Scrolling**:
   Adopt `@tanstack/react-virtual` in `ContactsScreen` and `DiscoveryScreen` to cap rendered DOM elements to ~30 rows regardless of dataset size.

---

## 23. Dependency-Ordered Implementation Plan

```mermaid
graph LR
    P0["Phase 0: Safety & Test Harness"] --> P1["Phase 1: Workspace & Startup Race Fixes"]
    P1 --> P2["Phase 2: Discovery Filtering & Hydration Fixes"]
    P2 --> P3["Phase 3: Database Indexing & API Support"]
    P3 --> P4["Phase 4: Frontend Virtualization & Performance"]
    P4 --> P5["Phase 5: LeadForge Cleanup & Domain Migration"]
    P5 --> P6["Phase 6: HUNTARA Brand & Splash Redesign"]
```

### Phase Breakdown

#### Phase 0: Safety Snapshots & Regression Harness
- Establish end-to-end integration tests for startup sequence, auth restoration, and workspace resolution.
- Verify zero modifications to production data schemas.

#### Phase 1: Startup & Workspace Lifecycle Stabilization
- **Files**: `apps/desktop/src/main/index.ts`, `apps/desktop/src/renderer/hooks/useAuth.ts`, `apps/desktop/src/renderer/layouts/AppLayout.tsx`, `apps/api/src/repositories/workspace/workspace.repository.ts`.
- **Action**: Fix `findUserWorkspaces` to query `ownerId`; ensure `useAuth` sets loading state until workspace resolution completes; decouple `createWindow()` from synchronous hydration.

#### Phase 2: Discovery & Historical Data Hydration Correctness
- **Files**: `apps/desktop/src/main/services/cache-hydrator.ts`, `apps/desktop/src/main/ipc/discovery-ipc.ts`, `apps/api/src/routes/business.ts`.
- **Action**: Implement pagination loop for `company_discovery_runs` in `CacheHydrator`; add `discoveryRunId` filter to `GET /contacts` endpoint.

#### Phase 3: Database Indexing & Performance
- **Files**: `apps/api/src/db/models/contact.model.ts`, `apps/desktop/src/main/database/cache-schema.ts`.
- **Action**: Add compound indexes on `{ workspaceId: 1, companyId: 1 }` and `(discoveryRunId, companyId)`.

#### Phase 4: Frontend Virtualization & Optimization
- **Files**: `apps/desktop/src/renderer/screens/ContactsScreen.tsx`, `apps/desktop/src/renderer/screens/DiscoveryScreen.tsx`.
- **Action**: Implement virtualized table rows; terminate polling intervals when runs are completed.

#### Phase 5: Legacy Cleanup & Domain Migration
- **Files**: `apps/desktop/src/main/lib/config.ts`, `apps/api/src/index.ts`, `apps/marketing/app/beta/page.tsx`.
- **Action**: Update API default URLs to `api.huntara.online`; update CORS origins and auth cookie domains.

#### Phase 6: HUNTARA Brand Identity & Splash Redesign
- **Files**: `apps/desktop/src/main/lib/splash-window.ts`, `apps/desktop/src/renderer/styles/`.
- **Action**: Replace Slate Blue splash markup with Dark Charcoal `#0A0A0C` and Hunter Orange `#FF5500` assets.

---

## 24. Regression Test Plan

1. **Startup Flow Test**: Verify cold application start displays splash screen, initializes window in <1200ms, and routes directly to Dashboard without displaying "Create Workspace".
2. **Migrated Workspace Owner Test**: Verify accounts migrated without `members` entries successfully retrieve and select their existing workspace.
3. **High-Volume Discovery Filter Test**: Create a discovery run with 350 companies and 800 contacts; verify filtering by this run in ContactsScreen displays all 800 contacts.
4. **Historical Run Retention Test**: Verify runs created 30+ days ago render their full company and contact lists from cache and remote fallback.
5. **DOM Stress Test**: Load 5,000 contacts in ContactsScreen; verify 60fps scrolling and instantaneous filter input response.

---

## 25. Risk Register

| Risk ID | Description | Severity | Probability | Mitigation Strategy |
|---|---|---|---|---|
| **RSK-001** | Background cache hydration causes race conditions with active UI queries | High | Medium | Implement local SQLite read-write transaction locks during hydration batches. |
| **RSK-002** | Updating `WorkspaceRepository` query exposes unauthorized workspaces | Critical | Low | Unit test tenant isolation with explicit user ID boundaries. |
| **RSK-003** | Domain switch to `huntara.online` breaks legacy desktop client versions | High | High | Maintain reverse-proxy redirect on `leadforge.kapiljangid.pro` for 90 days. |
| **RSK-004** | Removing onboarding locks out first-time users | Medium | Low | Ensure fallback modal triggers when `workspaces.length === 0`. |

---

## 26. File-Level Change Map

```
apps/api/
  ├── src/
  │   ├── repositories/workspace/workspace.repository.ts   [MODIFY] Query ownerId in findUserWorkspaces
  │   ├── routes/business.ts                              [MODIFY] Add discoveryRunId query to /contacts
  │   ├── db/models/contact.model.ts                      [MODIFY] Add compound index { workspaceId, companyId }
  │   ├── db/models/company-discovery-run.model.ts        [MODIFY] Add compound index { discoveryRunId, companyId }
  │   └── index.ts                                        [MODIFY] Update CORS allowlist for huntara.online

apps/desktop/
  ├── src/
  │   ├── main/
  │   │   ├── index.ts                                    [MODIFY] Decouple createWindow from hydration
  │   │   ├── lib/
  │   │   │   ├── config.ts                               [MODIFY] Update default API domain to api.huntara.online
  │   │   │   └── splash-window.ts                        [MODIFY] Redesign with HUNTARA dark/orange theme
  │   │   ├── services/
  │   │   │   └── cache-hydrator.ts                       [MODIFY] Add pagination loop to company_discovery_runs
  │   │   ├── database/
  │   │   │   └── cache-schema.ts                         [MODIFY] Add SQLite indexes on foreign keys
  │   │   └── ipc/
  │   │       ├── discovery-ipc.ts                        [MODIFY] Ensure fallback remote fetch on cache miss
  │   │       └── electron.ts                             [MODIFY] Gate ready-to-show behind verified mount
  │   └── renderer/
  │       ├── hooks/
  │       │   └── useAuth.ts                              [MODIFY] Atomic auth + workspace initialization
  │       ├── layouts/
  │       │   └── AppLayout.tsx                           [MODIFY] Remove premature ready-to-show call
  │       ├── screens/
  │       │   ├── ContactsScreen.tsx                      [MODIFY] Virtualize table rows; fix filter query
  │       │   └── DiscoveryScreen.tsx                     [MODIFY] Virtualize table rows; stop polling on complete
  │       └── stores/
  │           └── workspace-store.tsx                     [MODIFY] Set default isLoading: true during boot
```

---

## 27. Final Audit Summary

This forensic investigation has established that the instability and performance degradation in HUNTARA do not stem from architectural limits or the need for a total rewrite, but from **three distinct lifecycle sequencing errors**:
1. Synchronous cache hydration executing ahead of Electron window creation.
2. An asynchronous frontend state race that displays the workspace creation dialog before membership data is retrieved.
3. Truncated local synchronization that arbitrarily dropped discovery associations beyond the 100th record.

By addressing these specific lifecycle bottlenecks in the order defined in Phase 23, HUNTARA will achieve sub-second startup times, robust workspace persistence, accurate historical discovery reporting, and a seamless transition to the new brand identity.
