# LeadForge OS — Current Architecture Specification

**Document:** `current-architecture.md`  
**Status:** Certified Production Architecture ✅  
**Last Updated:** 2026-08-31  

---

## 1. High-Level Architecture Overview

LeadForge OS is built on a **MongoDB-First, Disposable Local Cache** architecture designed for multi-tenant scalability, zero cross-device synchronization ambiguity, and deterministic offline resilience.

```text
                               ┌────────────────────────────────┐
                               │        MongoDB Cluster         │
                               │  [Sole Source of Truth (SSOT)] │
                               └───────────────▲────────────────┘
                                               │
                                       (Mongoose ODM)
                                               │
                               ┌───────────────┴────────────────┐
                               │      Hono REST API Layer       │
                               │ [Authoritative Business Bounds]│
                               └───────▲────────────────▲───────┘
                                       │                │
                             (HTTP / SdkClient)   (HTTP / SdkClient)
                                       │                │
             ┌─────────────────────────┴────┐      ┌────┴──────────────────────────┐
             │       Electron Desktop       │      │        Worker Host & Runtime  │
             │   [UI & Local Interaction]   │      │ [Scrapers/Crawlers/Automation]│
             │                              │      │                               │
             │  ┌────────────────────────┐  │      │  - Ephemeral in-memory queue  │
             │  │ Disposable SQLite Cache│  │      │  - Exclusive Mongo persistence│
             │  │   (< 5ms read latency) │  │      │  - Distributed atomic leases  │
             │  └────────────────────────┘  │      └───────────────────────────────┘
             └──────────────────────────────┘
```

---

## 2. Core Architectural Subsystems

### 2.1 Canonical Identity & Schemas
- **UUID Identifiers:** All domain entities generate canonical string UUIDs via `@leadforge/schema` (`generateEntityId()`).
- **Zero BSON ObjectIds:** MongoDB collections and domain documents strictly utilize string `_id` values and string foreign keys.
- **Shared Contracts:** Zod and TypeScript schemas in `packages/schema` serve as the single source of type definitions across API, desktop, SDK, and worker layers.

### 2.2 Persistence & Database Boundary
- **Authoritative Boundary:** The Hono REST API (`apps/api`) owns all business validation, database mutations, and access control.
- **MongoDB Models:** 35 Mongoose models in `apps/api/src/db/models` enforce workspace isolation (`workspacePlugin`), timestamps (`timestampPlugin`), unique compound indexes, and TTL expiration.
- **Direct Mongo Write Prohibition:** Desktop and Worker runtimes never directly open database connections to MongoDB; all mutations occur via `SdkClient`.

### 2.3 Desktop Disposable SQLite Read-Cache
- **Cache Role:** SQLite (`better-sqlite3`) in `apps/desktop` is strictly a disposable materialized read-cache for UI responsiveness.
- **Cache Schema:** Initialized via `initCacheSchema()` in `cache-schema.ts` with explicit `id TEXT PRIMARY KEY` constraints and workspace indices.
- **Reconstructibility:** If local SQLite files are deleted or corrupted, `CacheHydrator` re-populates the cache from MongoDB via the REST API with zero data loss.
- **Zero Local Authority:** No business writes originate in SQLite; local-first sync queues and migration runners are permanently retired.

### 2.4 Worker & Background Job Runtime
- **Persistence Exclusivity:** Scrapers, crawlers, and automations persist data exclusively via `SdkClient` endpoints (`POST /api/v1/jobs/:id/checkpoint`, `POST /api/v1/jobs/:id/complete`).
- **Distributed Scheduler:** MongoDB-backed `JobModel` with atomic `$set: { status: 'running', workerId, leaseExpiresAt }` leases ensures exactly one worker processes any task.
- **Distributed Automation Locks:** `AutomationLockModel` with compound unique `(workspaceId, lockKey)` and atomic release prevents race conditions.

### 2.5 Outreach & Outbound Delivery Engine
- **Gmail API Exclusivity:** Outbound cold outreach is sent exclusively via official Google Gmail OAuth APIs (0 SMTP paths).
- **Multi-Sender Isolation:** Multiple Gmail profiles coexist cleanly per workspace, with user-scoped connection ownership and non-contaminating token refresh loops.
- **Google Drive Attachments:** Large binary attachments are uploaded directly to Google Drive; MongoDB `AttachmentModel` stores durable file IDs and download tokens.
- **Immutable Delivery Ledger:** `EmailDeliveryModel` tracks every outbound message from reservation (`QUEUED`) to completion (`SENT`), enforcing unique `(workspaceId, idempotencyKey)` to prevent duplicate sends.

### 2.6 Multi-Tenancy, Security & Privacy
- **Strict Workspace Scoping:** Every Mongoose query, API route, and SQLite table filters by `workspaceId`.
- **Zero Secret Exposure:** OAuth client secrets, refresh tokens, and encryption keys are scrubbed before reaching SQLite cache tables, renderer IPC, or audit logs.

---

## 3. Subsystem Architecture Specifications

For detailed architectural invariants, contracts, and state machines, see:
- [Immutable Outreach Lineage & Template Versioning](./outreach-lineage.md)
- [Inbound Reconciliation & Suppression Consistency](./inbound-suppression.md)
- [Operational Reliability & Mailbox Health](./operational-reliability.md)
- [System Invariants & Production Qualification Matrix](./system-invariants-matrix.md)
- [Workflow Engine Evaluation](./workflow_engine_evaluation.md)

---

## 4. Disaster Recovery & Operations

- **Disaster Recovery:** If a client machine fails or SQLite cache becomes unreadable, `resetWorkspaceCache()` safely archives the corrupt file as `.bak` and rebuilds a clean cache from MongoDB via the REST API.
- **Cache Reconstruction:** SQLite projections are completely rebuildable from authoritative MongoDB state at any time (`FALLBACK-20`).

