# @huntara/workflow-engine

Lightweight, composable Directed Acyclic Graph (DAG) execution engine for autonomous AI tool chaining and data transformations.

## Purpose & Scope

This package is dedicated to **agentic tool execution** and pipeline orchestration for `@huntara/agent-runtime`.

It is **NOT** the campaign sequence engine for cold email outreach. Campaign sequence automation is authoritatively executed by the worker plugin at `apps/desktop/src/main/workers/plugins/automation.ts` with persistent MongoDB leases and SQLite projections.

For full architectural comparison and decision rationale, see [docs/architecture/workflow_engine_evaluation.md](../../docs/architecture/workflow_engine_evaluation.md).

## Features

- DAG step orchestration (`ToolStep`, `LLMStep`, `TransformStep`, `ConditionStep`)
- Step-level input/output mapping and validation
- Execution context and memory event streaming
- Gated human-in-the-loop tool approvals
