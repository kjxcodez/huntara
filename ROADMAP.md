# HUNTARA Project Roadmap

This roadmap tracks the development progress of HUNTARA. It outlines what features are completed, in progress, and planned for future updates.

---

## ✅ Completed (v1.0.0-beta.1)

- [x] **Local-First Datastores**: Workspace-isolated SQLite databases with WAL (Write-Ahead Logging) mode and automatic connection pools.
- [x] **Idempotent Migration Runner**: Schema updates validated via `runner.ts` with automatic backup restoration (`.migration.bak`) on transaction failures.
- [x] **Sandboxed Worker Host**: Multi-process task execution fork module preventing heavy scraping engines from blocking the React UI thread.
- [x] **Scheduler Watchdog**: Ping/pong heartbeat monitoring of background worker health with auto-kill (SIGKILL) and exponential retry policies.
- [x] **Playwright Google Maps Scraper**: Infinite-scroll business discovery with redirect resolving and automatic crawl trigger chaining.
- [x] **Cheerio Domain Crawler**: Breadth-First Search crawling for harvesting phone numbers, email strings, and ignoring spam/tracking signatures.
- [x] **LinkedIn Voyager API Integrations**: Direct extraction of key executive contacts leveraging user session cookies.
- [x] **Local CRM & Sequential Sequence Builder**: Offline interface for lead pipeline visualization, drag-and-drop workflow step configurations, and Nodemailer SMTP sending.
- [x] **SRE Cockpit Observability**: Integrated local metrics averages, real-time log parsing, database diagnostics tests, and manual backup recovery console.

---

## 🏃 Current (In Progress)

- [ ] **Comprehensive Documentation System**: Auditing all historical files, moving documents to archived and ADR folders, and creating professional user/developer manuals.
- [ ] **Dependency Cruiser Boundaries Integration**: Hardening boundary rules to prevent cyclical imports between Hono server APIs and Electron processes.
- [ ] **Electron safeStorage Fallback Hardening**: Improving safeStorage fallback options on Linux/Mac where native keyring APIs may be locked.

---

## 📅 Planned (Upcoming Releases)

- [ ] **Local RAG & Vector Embeddings**: Integrating `sqlite-vec` directly in SQLite migrations to run offline semantic search and qualify leads against local context.
- [ ] **Third-Party Email Verification Adapters**: Implementing concrete integrations (e.g. Hunter, ZeroBounce) behind the `verification.ts` adapter wrapper.
- [ ] **Multi-Platform Installer Builds**: Implementing macOS (`.dmg`) and Linux (`.AppImage`) compile routines inside `electron-builder.yml` to support cross-platform releases.
- [ ] **Workspace Sync Optimization**: Adding delta-based compressions in the `SyncEngine` when pushing local updates to Hono cloud APIs.

---

## 🔮 Future Explorations

- [ ] **Auto-Updater Integration**: Hardening signature checking routines and testing automatic package downloads via GitHub Releases on macOS.
- [ ] **Shared Plugin Registry**: Creating isolated sandboxes for custom community scrapers and sequence steps.
- [ ] **Team Collaboration Workspace**: Cloud synchronization workspace pools allowing multiple local instances to merge lead data conflicts via CRDT.
