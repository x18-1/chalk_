---
version: 1
slug: "apps-web-src-app-observability-page-tsx"
primary_target: "apps/web/src/app/observability/page.tsx"
related_targets: ["apps/web/src/app/observability/observability.module.css"]
---

## Scope and Mode

`/observability` is a desktop Operate surface inside the administrator backend. The initial active module is `Agent Trace`, a bounded inspection point for persisted Agent call summaries.

## Audience and Job

An administrator needs to identify a recent conversation by title, open its call history, and assess execution outcome, timing, model, token use, cost, and recent error category.

## Content and Primary Task

The page uses only the admin telemetry APIs. It presents conversation titles, identifiers and structured call summaries; it never exposes user identities, transcript text, prompts, completions, or tool inputs and outputs.

## Chosen Direction

The diagnostic ledger pairs a narrow list of recently active conversation titles with one detailed call table. A dedicated administrator rail establishes the future backend navigation without exposing operational tools in the student UI.

## Constraints

Desktop only. Preserve Chalk's warm-paper operating system and restrained semantic statuses. Real loading, empty, error and forbidden states are required. The detailed span trace remains process-local and is not represented as durable history here.

## Unresolved Decisions

Durable span storage, retention policy, audit logging for transcript access, date filtering, alerting and external telemetry adapters remain future observability work.
