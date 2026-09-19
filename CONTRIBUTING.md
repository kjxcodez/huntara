# Contributing to HUNTARA

Thank you for your interest in contributing to HUNTARA! This document outlines our development philosophy, coding standards, branching strategies, and testing requirements to help maintain a stable, clean, and secure local-first codebase.

---

## 💡 Development Philosophy

1. **Local-First & Offline Ready**: All features should remain functional without a network connection. Cloud APIs should be optional sync adapters, never blockers.
2. **UI Responsiveness is Critical**: The Electron UI must remain smooth and responsive (maintain 60fps). Never run synchronous file system operations, heavy calculations, or scraping tasks directly in the React UI or Electron Main threads. Use sandboxed child workers.
3. **No Unused Code or Duplication**: Maintain modular package boundaries. Do not duplicate logic between the Hono REST API server (`apps/api/`) and the Electron application (`apps/desktop/`). Use shared packages under `packages/` (e.g. `@huntara/schema`).
4. **Absolute Privacy by Design**: Credentials and API keys must never be logged or exposed in plaintext. When writing logs or export bundles, ensure that sensitive strings are automatically masked.

---

## 🛠️ Coding Standards

We enforce strict formatting and static code checks:

- **TypeScript**: We require strict type checking. Avoid the use of `any`. Explicitly type parameters and function returns.
- **Formatting**: Code formatting is handled automatically by Prettier. Run `pnpm format` before proposing changes.
- **Linting**: We use ESLint flat configuration. Run `pnpm lint` to make sure there are no lint warnings or errors.
- **Directory Layout Rules**: Maintain package boundaries. `@huntara/desktop` can import from packages, but packages cannot import from `apps/desktop` or each other in a circular fashion.

---

## 🔱 Branching Strategy

Our git branching model follows a structured path to production:

- **`main`**: The stable production release branch. All commits must be tagged and verified by release gates.
- **`dev`**: The active development integration branch. Feature branches merge into `dev`.
- **Feature Branches (`feat/...` or `fix/...`)**: Local feature implementation branches. Create these off `dev`.
  - Example naming convention: `feat/maps-scraper-infinite-scroll`, `fix/imap-auth-recheck`.

---

## 📝 Commit Conventions

We follow the **Conventional Commits** standard to automatically generate release notes and manage version increments:

Format: `<type>(<scope>): <description>`

### Standard Types

- `feat`: A new feature implementation.
- `fix`: A bug fix.
- `docs`: Documentation-only updates.
- `style`: Changes that do not affect code logic (formatting, spacing).
- `refactor`: Code restructurings that neither fix bugs nor add features.
- `test`: Adding or modifying tests.
- `chore`: Infrastructure, build configuration, or package dependency updates.

### Examples

- `feat(scheduler): add SIGKILL timeout trigger for stalled workers`
- `fix(sync): resolve LWW conflict logic on deleted contact items`
- `docs(api): add OpenAPI spec definitions for workspace sync`

---

## ✉️ Pull Requests & Code Review

1. **Create the PR**: Target your PR to the `dev` branch.
2. **Run Diagnostic Tools**: Ensure that `pnpm doctor` passes on your local machine.
3. **Release Gate Check**: Run `pnpm release:check` to verify changesets are ready.
4. **Code Review**: Every PR requires review and approval from at least one core maintainer before merging.
5. **Merge**: Once approved, changes will be merged into `dev` and subsequently batched into a production release.

---

## 🧪 Testing Requirements

We require automated tests for all logic changes:

- **Unit & Integration Tests**: Run `pnpm -r test` to verify package logic.
- **SRE Smoke Tests**: If your changes impact the scheduler, databases, or event loops, execute the headless smoke tests via `npx electron scripts/temp-smoke.js` (or via the wrapper `pnpm test`).
- **Mock External Interfaces**: Do not call live APIs during unit/integration tests. Implement proper mocks for OpenRouter, Ollama, SMTP, and Playwright browsers.

For comprehensive details on running and writing tests, view the [Testing & QA Guide](file:///c:/Users/91637/Desktop/Business%20Project/leadforge-os/docs/testing/README.md).

---

## 📜 Documentation Requirements

Documentation is a first-class citizen in HUNTARA:

- If you modify database schemas or add new entities, update [docs/architecture/README.md](file:///c:/Users/91637/Desktop/Business%20Project/leadforge-os/docs/architecture/README.md) and record the migrations.
- If you add new tools or worker plugins, update the developer guides in [docs/development/README.md](file:///c:/Users/91637/Desktop/Business%20Project/leadforge-os/docs/development/README.md).
- If your change affects user navigation, settings, or CLI setups, update [docs/getting-started/README.md](file:///c:/Users/91637/Desktop/Business%20Project/leadforge-os/docs/getting-started/README.md).

---

## 🚀 Release Process

1. **Add Changeset**: If your PR contains user-facing changes, run `npx changeset` to describe the version change (major, minor, or patch) and write release notes.
2. **Tagging**: Code compilation and tagging are orchestrated automatically on release gates check.
3. **Packaging**: Releases are compiled via Electron Builder and distributed through GitHub Releases.
