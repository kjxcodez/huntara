# Architectural Evaluation: Workflow Engine vs. Campaign Sequence Automation
**Document Identifier**: `ENGINE-DUPLICATION-17`  
**Date**: September 2026  
**Status**: Formally Adopted (Option C: Distinct Boundaries)

---

## 1. Context & Motivation

During the operational reliability audit, a potential architectural duplication was flagged between two execution engines in the codebase:
1. `packages/workflow-engine` (a standalone package defining DAG workflows, runners, and tool invocations).
2. `apps/desktop/src/main/workers/plugins/automation.ts` (a large worker plugin executing automation workflows).

This evaluation formally investigates both implementations to determine whether they represent redundant runtime architectures that should be consolidated, or whether they serve fundamentally distinct execution concerns that require explicit, formal architectural boundaries.

---

## 2. Technical Comparison Matrix

| Criterion | `packages/workflow-engine` | `apps/desktop/src/main/workers/plugins/automation.ts` |
| :--- | :--- | :--- |
| **Primary Domain** | Agentic AI Tool Execution & Data Pipelines | Deterministic CRM Sequence Outreach |
| **Runtime Consumer** | `@huntara/agent-runtime` | HUNTARA Desktop Background Worker Host (`worker-host.ts`) |
| **Execution Model** | In-memory Directed Acyclic Graph (DAG) of steps | Sequential step machine with asynchronous delay scheduling |
| **Supported Step Types**| `ToolStep`, `LLMStep`, `TransformStep`, `ConditionStep` | `SEND_EMAIL`, `WAIT_DELAY`, `CONDITIONAL_BRANCH` |
| **State Persistence** | Transient execution context (`WorkflowContext`), memory events | Authoritative MongoDB (`CampaignExecutionModel`), local SQLite projection |
| **Safety Invariants** | Tool permission gating, step timeout | Contact exclusivity, address suppression convergence, template lineage pinning |
| **Outreach Primitives** | None (no email accounts, mailboxes, or message composition) | Full outreach lifecycle: template rendering, secondary email fallback, bounce isolation, delivery correlation |
| **Dependency Footprint**| Standalone zero-dependency core package | Electron worker runtime, SdkClient, crypto, schema |

---

## 3. Options Evaluated

### Option A: Consolidate Outreach Sequences onto `workflow-engine`
* **Assessment**: Attempting to force transactional cold outreach campaigns onto the agent DAG engine would introduce extreme architectural instability. The `workflow-engine` lacks durable delay resumption, MongoDB execution lease persistence, contact exclusivity locking, template snapshot immutability, and provider-level error handling.
* **Verdict**: **REJECTED**. High risk of regressions in campaign safety invariants (Phases 14–17).

### Option B: Formally Retire `@huntara/workflow-engine`
* **Assessment**: Retiring `workflow-engine` would break `@huntara/agent-runtime`, which uses `workflow-engine` to orchestrate multi-step autonomous AI agent tool execution (e.g. search, scrape, transform).
* **Verdict**: **REJECTED**. Required by the agent runtime layer.

### Option C: Retain Both with Formal, Documented Architectural Boundaries
* **Assessment**: The two engines address completely separate concerns:
  1. `apps/desktop/src/main/workers/plugins/automation.ts` is the **authoritative Campaign Sequence Execution Engine**. It owns outreach delivery, contact lifecycle, schedule due-times, and mailbox cooldowns.
  2. `packages/workflow-engine` is the **Agentic Tool DAG Pipeline**. It owns in-process agent tool calling, LLM node chaining, and data transformations.
* **Verdict**: **ADOPTED**. This eliminates ambiguity without risky refactorings or breaking agent execution.

---

## 4. Operational Boundaries & Invariants

1. **No Outreach in `workflow-engine`**: `packages/workflow-engine` must never directly execute email sending or bypass the HUNTARA campaign scheduler.
2. **No Agent Tool DAGs in `automation.ts`**: Outreach sequence execution in `automation.ts` must remain focused on deterministic sequence steps (`SEND_EMAIL`, `WAIT_DELAY`, branch evaluation).
3. **Lineage & Audit Guarantee**: Sequence outreach continues to be authoritatively tracked in MongoDB `CampaignExecutionModel` and SQLite `campaign_executions`, ensuring zero loss of auditability.
