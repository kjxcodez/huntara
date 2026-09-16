# LeadForge OS Documentation

LeadForge OS is a local-first lead generation and cold outreach platform built as an Electron desktop application. By running crawlers, browser scrapers, and AI enrichments directly on local developer or user machines, it avoids high cloud infrastructure costs and secures sensitive outbound prospecting data.

This documentation serves as the technical reference for developers, contributors, and maintainers.

## Documentation Index

### Getting Started

- **[Setup & Installation](./getting-started/installation.mdx)**: Learn how to configure your local workspace, compile package dependencies, and run LeadForge OS in development mode.
- **[Deployment & Production Hosting](./deployment/README.mdx)**: Learn how to deploy the central Hono REST API server and compile distribution installers.
- **[Project Roadmap](./roadmap/README.mdx)**: Check completed milestones, active integrations, and future explorations.

### Architecture & Decisions

- **[Current Architecture Specification](./architecture/current-architecture.md)**: Certified production architecture, persistence boundaries, identity strategy, and subsystem specifications.
- **[System Architecture Overview](./architecture/system-overview.mdx)**: Electron process boundaries, workspace-isolated database pools, and runtime topologies.
- **[Third-Party Integrations & Adapters](./integrations/README.mdx)**: Deep dive into Playwright maps scrapers, Cheerio domain crawlers, and LinkedIn Voyager APIs.
- **[Workflow Engine](./workflows/workflow-engine.mdx)**: Understand sequence execution steps, concurrency locks, and transaction checkpoints.
- **[Architectural Decision Records](./adr/README.mdx)**: Review the list of formal design records and engineering choices.

### Operating & Extending

- **[Developer Guides](./development/developer-guides.mdx)**: Walkthroughs for extending worker plugins, registering agent tools, and adding database migrations.
- **[Testing & Quality Assurance](./testing/README.mdx)**: Run local unit, integration, and headless subsystem smoke test suites.
- **[Testing Architecture Specification](./testing/testing-architecture.md)**: Testing philosophy, layers, Vitest runner architecture, test doubles, and safety invariants.
- **[Security & Privacy](./security/security-privacy.mdx)**: Review OS safeStorage encryption pipelines, log credentials masking, and security compliance.
- **[Troubleshooting Guide](./troubleshooting/troubleshooting.mdx)**: Resolve SQLite binary mismatches, corrupt migrations, and connection errors.

### Contributing

- **[Contributing Guidelines](./contributing/contributing.mdx)**: Review development philosophies, Flat ESLint configurations, and Git workflow requirements.
- **[Release & Versioning](./release/release-process.mdx)**: Learn about changeset bumps and packaging pipelines.
