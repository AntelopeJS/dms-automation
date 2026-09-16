# @antelopejs/dms-automation

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

AntelopeJS DMS module that provides a visual automation builder under `/module/automation`. Author procedures as node graphs (triggers, actions, data nodes), wire trigger and data edges, and run them in response to events such as cron schedules and webhooks.

## Vue frontend

The module registers `frontend-vue` through `AddFrontendModule` with the Vue 3 renderer. `dms.frontend.ts` registers the Automation components and the client-only timeline display plugin. The generated Inertia application discovers the English and French locale files, while the host DMS provides shared composables and UI components.

The playground uses the published DMS and Inertia frontend packages. To build or typecheck the module frontend directly, first generate an Inertia workspace, set `DMS_FRONTEND_WORKSPACE` to its absolute path, then run:

```bash
pnpm --dir frontend-vue build
pnpm --dir frontend-vue typecheck
```

`pnpm test:frontend-registration` checks backend registration and configuration without starting database services or automation triggers.

## Interface

The public contract lives in a dedicated interface package,
[`@antelopejs/interface-dms-automation`](https://github.com/AntelopeJS/dms-automation/tree/main/packages/interface-dms-automation),
which this module `implements`. Any DMS module can declare its own automation nodes
(triggers, actions, data nodes) by depending on the interface package only — never on
this implementation module. Add it to `optionalDependencies` and call
`RegisterTriggerType` / `RegisterActionType` / `RegisterDataNodeType`; when
dms-automation is absent from the project the registrations are inert no-ops. See the
interface package README for the full guide and examples.

The builder's block palette groups each category by the module that registered its
entries: the built-ins shipped with dms-automation come first, unlabeled, followed by
one section per external module, labelled with the module's id as named in the
project's `antelope.config.ts`.

The interface package is released before dms-automation because the latter depends on
it. Both are published to npmjs from their own manually dispatched GitHub workflow:
run `Release DMS automation interface` first, then `Release DMS automation module`,
which refuses to run until the interface version wired as `workspace:*` is resolvable
on npmjs. Published package manifests replace the local `workspace:*` dependency with
the interface package version. Existing consumers of the old standalone interface must
move to `@antelopejs/interface-dms-automation` and update their `implements` or
optional-dependency wiring; no compatibility alias is provided.

## Clustering

By default dms-automation runs **standalone**: a single instance owns every trigger and there is nothing to configure.

To run multiple instances against shared state, wire `@antelopejs/interface-redis` in the consuming project's `antelope.config.ts` and start more than one instance. With Redis available the module coordinates the instances automatically — no per-instance config needed.

Mode resolution can be overridden with the optional `cluster.driver` config:

- `auto` (default) — use Redis if the `@antelopejs/interface-redis` interface is provided, otherwise run standalone.
- `redis` — force clustered mode; if the interface is absent it logs a warning and falls back to standalone.
- `memory` — force standalone mode even when Redis is wired.

### Firing semantics

Each trigger type declares how it behaves across a cluster:

- **`singleton`** (e.g. cron) — must fire exactly once cluster-wide. Only the elected leader activates it; followers stay idle. Leadership is a renewable Redis lock, so if the leader stops another instance takes over.
- **`replicated`** (e.g. webhook) — every instance activates it. The load balancer in front of the cluster already routes each incoming event to exactly one instance.

Procedure and template edits made on one instance propagate to the others over Redis pub/sub, so every instance reconciles its active triggers without a restart.

### Known limitations

Leadership uses a TTL'd Redis lock, so singleton triggers are **fire-once under
normal operation but not transactionally exactly-once** across leadership
changes. If a singleton trigger must never run twice, make its downstream effect
idempotent.

- **Missed occurrence on ungraceful leader death.** If the leader process dies without releasing its lock, a cron occurrence that falls inside the takeover window (up to the lock TTL, ≤30s) is missed; firing resumes once a new leader is elected. (A graceful shutdown releases the lock immediately, so this only applies to crashes/kills.)
- **Brief double-fire on handover.** When leadership moves, the new leader arms its singletons as soon as it acquires the lock, while the old leader only deactivates its copies on its next tick (≤ one tick interval) — or, for a stall/GC-pause longer than the lock TTL, after it notices it lost the lock. An occurrence landing in that overlap can fire on both. The window is bounded by the tick interval (and by the TTL for stalls), never unbounded.
- **No timeout on Redis itself.** Leader renewal and pub/sub ride the shared Redis client; a Redis server that accepts connections but stops responding (no command timeout configured) can stall a renew. The leader tolerates transient errors up to the TTL before stepping down, so this degrades to the missed-occurrence case rather than a hang.
- **Very slow promotion can self-evict.** When an instance wins the lock it activates its singletons before the renewal loop resumes; if that activation took longer than the lock TTL (≤30s) the lock could expire mid-promotion. Built-in trigger activation is sub-millisecond, so this only matters for a custom trigger whose `activate` blocks for tens of seconds — keep trigger `activate`/`deactivate` fast and non-blocking.

## Breaking changes in 0.0.1

This is the first release under the `@antelopejs` scope, renamed from the CMS
product. Every identifier that carried the old name moved with it, and there is
no compatibility path: a deployment is recreated from scratch, not migrated.

- Database `cms-automation` -> `dms-automation`, schema `cms_automation` ->
  `dms_automation`. Existing collections are invisible to this version.
- Module config key `cmsAutomation` -> `dmsAutomation` in `antelope.config.ts`.
- Frontend i18n namespace `cms-automation-<locale>` -> `dms-automation-<locale>`;
  a host overriding those keys has to rename its own entries.
- The contract lives in `@antelopejs/interface-dms-automation`, which this
  module `implements`. Import it from there, never from the runtime package,
  and note that `TriggerType` requires a `cluster` field.
