---
name: dms-automation
description: Uses the @antelopejs/dms-automation module of the AntelopeJS DMS (procedures as node graphs started by schedules, webhooks, manual runs or DMS events, with run history and traces under /modules/automation). Use when installing or configuring dms-automation (runs.retentionDays, runs.sensitiveNames, httpRequest.blockPrivateNetwork, cluster.driver), creating, importing or shipping a procedure as code, debugging a failing run, or choosing a trigger (table watch needs a MongoDB replica set). To declare new nodes from a module, use dms-automation-interface instead.
icon: i-lucide-workflow
category: automation
tags: [automation, procedures, workflows, triggers, webhooks, cron]
---

# dms-automation

Runs procedures: a trigger starts a run, actions run along trigger edges, data nodes compute values along data edges, flow nodes (If, Switch, For each, Try/Catch, Retry, Delay…) branch and loop. Every run keeps a trace. User docs: https://dms.antelopejs.com/docs/modules/automation (source: `docs/` of this package). Declaring nodes from another module: the `dms-automation-interface` skill.

## Key facts

- Pages (owner-only): Overview, Procedures, Builder (`/modules/automation/builder?selected=<id>`), Run history, Run trace (`/modules/automation/trace?run=<id>`), Library.
- Overview, Run history and Procedures are live pages whose first block is the DMS `PageToolbar` (`@antelopejs/interface-dms/base/page-toolbar`): updated label + Live / Pause, plus on Overview and Run history the shared 24H / 7D / 30D period (`rememberKey: "automation"`, comparison menu over `previous-period` (default) / `none`, plus `previous-year` only when `runs.retentionDays` reaches a year and 30 days (or is 0), which `pageToolbar()` draws as a menu; the KPI routes read the `compareFrom` / `compareTo` the scope resolves and drop them on `comparison=none` or when no run kept reaches back to them; the Overview's runs chart (`/stats/runs-per-day`) does the same and answers `comparisonSeries`, the compared runs per bucket as a dashed `type: "line"` series over the stacked bars, plus `previousValue` / `delta` like the Runs KPI). Every period-scoped KPI and chart on those pages shows the comparison; the lists (attention, recent runs, procedure counts, triggers) are not period comparisons. No layout shift: each block's skeleton is the size of what it loads. The recent runs and procedure counts draw `RECENT_RUNS` / `PROCEDURE_COUNT_LINES` skeleton rows (from `src/stats/overview.ts`, the counts the routes send), the runs chart carries a `description` that holds the line under its total when no comparison answers, and the attention list draws two skeleton rows shaped like loaded ones, as tall as its empty state. Live: the `topics` block calls `refreshLivePageBlocks()` on each `automation.runs` / `automation.procedures` event, so every block reads through the page's live gate (no block carries its own `realtimeTopic`); the Run history and Procedures tables set `liveHold`. Its block id stays `live` (children `topics`, `toggle`, `period`, placed by `pageToolbar()` with `live.childId: "toggle"`) on Overview and Run history, `toolbar` on Procedures.
- API under `/api/automation` (owner-only). A procedure exported from the builder (`{ name, description, graph }`) is re-created with `POST /api/automation/procedures/import` `{ json }` as a disabled draft; `PUT …/:id/enabled` `{ enabled }` enables it; `POST …/:id/run-now` `{ payload }` runs it.
- Procedures shipped by a project or module as code: `DeclareProcedure({ id, name, description, graph, enabled })` from `@antelopejs/interface-dms-automation`, called in `start()` (keyed by `id`, which becomes the procedure id; created once, then never touched; enabled = armed at once). Never insert into the module's tables directly: not armed until restart, couples to the internal schema. Details: the `dms-automation-interface` skill.
- States: failing (last run failed, or the trigger cannot be armed), degraded (a failure in 7 days), healthy, paused, draft. Test runs never count.

## Config (`antelope.config.ts`, all optional)

`runs.retentionDays` (30; 0 keeps all), `runs.sensitiveNames` (extra credential names, stored as `[redacted]`), `httpRequest.blockPrivateNetwork` (false), `cluster.driver` (`auto` | `redis` | `memory`).

## Gotchas

- Webhook paths cannot overlap an existing route or start with `/api`, `/auth`, `/dms`, `/modules`, `/settings`; two enabled procedures cannot share method + path. URLs shown use the DMS `apiBaseUrl` (the API server, not the frontend server).
- Version 0.4+ needs `@antelopejs/dms` 0.9 (`interface-dms` 0.7) and `@antelopejs/dms-frontend` 0.6; 0.3 is the DMS 0.8 line.
- **Test run** simulates only actions declaring `dryRun` (and runs `sideEffects: false` ones as is); every other action (HTTP request, module actions without `dryRun`) acts for real. The builder lists those steps and asks first; `POST …/:id/test` answers 409 with `realEffects` until called with `confirmRealEffects: true` (`POST …/:id/test-effects` `{ graph }` lists them). To make a project or module action safe to test, give it `dryRun` (see `dms-automation-interface`).
- A re-run sends `[redacted]` where the original request held credentials.
- Data-change triggers on a project's own tables: `database.table-watch` from `@antelopejs/dms-database` (`schema` = the `RegisterSchema` id, `table`). It needs a change feed: MongoDB **replica set** only (single node `--replSet rs0` + `rs.initiate()` + `replicaSet=rs0` in the URL); on a standalone server the procedure is Failing with "$changeStream is only supported on replica sets".
- A trigger type registered after the module armed its procedures (start order, hot reload) arms them on registration; "not available" that lasts means the registering module is not loaded.
- A module stopping or hot-reloading has its triggers torn down as its types are unregistered ; a run on its steps fails, like any other error.
- From backend code, `InvokeProcedure` needs a manual trigger node; `RunProcedure(id, { payload?, triggerNodeId? })` runs any procedure (cron-only, webhook-only…) as the builder's Run now and resolves to `{ runId, status, errorMessage? }`.
- In a Redis cluster, singleton triggers (cron, table watch) are fire-once, not exactly-once: make their effects idempotent.
- Keep credentials out of graphs: every builder user sees them.
- Turn on `blockPrivateNetwork` when untrusted people build procedures or URLs come from payloads.
