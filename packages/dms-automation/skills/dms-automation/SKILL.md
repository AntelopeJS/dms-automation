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
- API under `/api/automation` (owner-only). A procedure exported from the builder (`{ name, description, graph }`) is re-created with `POST /api/automation/procedures/import` `{ json }` as a disabled draft; `PUT …/:id/enabled` `{ enabled }` enables it; `POST …/:id/run-now` `{ payload }` runs it.
- Procedures shipped by a project or module as code: `DeclareProcedure({ id, name, description, graph, enabled })` from `@antelopejs/interface-dms-automation`, called in `start()` on every boot (idempotent, keyed by `id`, which becomes the procedure id; enabled = armed at once; never overwrites a procedure someone changed). Never insert into the module's tables directly: not armed until restart, couples to the internal schema. Details: the `dms-automation-interface` skill.
- States: failing (last run failed, or the trigger cannot be armed), degraded (a failure in 7 days), healthy, paused, draft. Test runs never count.

## Config (`antelope.config.ts`, all optional)

`runs.retentionDays` (30; 0 keeps all), `runs.sensitiveNames` (extra credential names, stored as `[redacted]`), `httpRequest.blockPrivateNetwork` (false), `cluster.driver` (`auto` | `redis` | `memory`).

## Gotchas

- Webhook paths cannot overlap an existing route or start with `/api`, `/auth`, `/dms`, `/modules`, `/settings`; two enabled procedures cannot share method + path. URLs shown use the DMS `apiBaseUrl` (the API server, not the frontend server).
- Version 0.4+ needs `@antelopejs/dms` 0.9 (`interface-dms` 0.7) and `@antelopejs/dms-frontend` 0.6; 0.3 is the DMS 0.8 line.
- A re-run sends `[redacted]` where the original request held credentials.
- Data-change triggers on a project's own tables: `database.table-watch` from `@antelopejs/dms-database` (`schema` = the `RegisterSchema` id, `table`). It needs a change feed: MongoDB **replica set** only (single node `--replSet rs0` + `rs.initiate()` + `replicaSet=rs0` in the URL); on a standalone server the procedure is Failing with "$changeStream is only supported on replica sets".
- A trigger type registered after the module armed its procedures (start order, hot reload) arms them on registration; "not available" that lasts means the registering module is not loaded.
- A module stopping or hot-reloading has its triggers torn down as its types are unregistered (no `ModuleContextInvalidatedError`); a run on its steps ends `cancelled`, not `failed`, and health figures ignore cancelled runs.
- In a Redis cluster, singleton triggers (cron, table watch) are fire-once, not exactly-once: make their effects idempotent.
- Keep credentials out of graphs: every builder user sees them.
- Turn on `blockPrivateNetwork` when untrusted people build procedures or URLs come from payloads.
