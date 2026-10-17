---
name: dms-automation-interface
description: Provides the AntelopeJS DMS automation interface for declaring trigger, action and data node types from any module, shipping procedures as code, listing node types and invoking procedures. Use when importing "@antelopejs/interface-dms-automation", when adding automation nodes to the DMS procedure editor, when a module or project must create procedures at startup (demo content, templates), or when working with RegisterTriggerType, RegisterActionType, RegisterDataNodeType, DeclareProcedure, ListTriggerTypes, ListActionTypes, ListDataNodeTypes, InvokeProcedure, TriggerType, ActionType, DataNodeType, ProcedureGraph or ExecutionCtx.
icon: i-lucide-workflow
category: antelopejs-interface
tags: [antelopejs, dms, automation, workflow, interface]
---

# DMS Automation Interface

Lets any AntelopeJS module declare automation node types — triggers, actions and data
nodes — that appear in the DMS automation procedure editor, without depending on the
automation module implementation. Registration functions are consumer-side helpers
backed by a `RegisteringProxy`: they are always safe to call, are queued until an
implementation attaches, and are inert no-ops when none ever does. The list/invoke
functions are real proxy crossings that reject when no implementation is present.

## Imports

```ts
import {
  RegisterTriggerType,
  UnregisterTriggerType,
  RegisterActionType,
  UnregisterActionType,
  RegisterDataNodeType,
  UnregisterDataNodeType,
  ListTriggerTypes,
  ListActionTypes,
  ListDataNodeTypes,
  InvokeProcedure,
  DeclareProcedure,
  type ProcedureDeclaration,
  type DeclaredProcedure,
  type ProcedureGraph,
  type TriggerType,
  type ActionType,
  type DataNodeType,
  type ExecutionCtx,
  type JsonSchema,
  type LogLevel,
} from "@antelopejs/interface-dms-automation";
```

Single entry point only — there are no subpath exports.

## Declaring an action node (typical consumption)

```ts
export function start(): void {
  RegisterActionType({
    id: "bakery.restock-order",
    name: "Place restock order",
    description: "Order an ingredient restock from a supplier",
    icon: "i-lucide-shopping-cart",
    inputSchema: {
      type: "object",
      properties: { ingredient: { type: "string" }, supplier: { type: "string" } },
      required: ["ingredient", "supplier"],
    },
    outputSchema: { type: "object", properties: { ordered: { type: "boolean" } } },
    async execute(input: unknown, ctx) {
      ctx.log("info", "placing restock order", input);
      return { ordered: true };
    },
  });
}

export function stop(): void {
  UnregisterActionType("bakery.restock-order");
}
```

Triggers and data nodes follow the same pattern with `RegisterTriggerType` /
`RegisterDataNodeType` — but triggers take `configSchema` (there is no
`inputSchema` on triggers) plus `cluster`/`activate`/`deactivate`, and data nodes
additionally require a `category` string (editor palette grouping). Querying and
invoking:

```ts
const actions = await ListActionTypes();
const runId = await InvokeProcedure(procedureId, { some: "payload" });
```

## Shipping procedures as code

`DeclareProcedure` creates a procedure from a module's backend, keyed by a stable
id you choose (it becomes the procedure's id). Call it on every boot from
`start()` or a `Hook.DATABASE_INITIALIZED` handler: it waits for the automation
module to start, and never in `construct()` with `await` (deadlock: modules start
after every construct).

```ts
const declared = await DeclareProcedure({
  id: "sales.quote-follow-up", // "<module>.<procedure>", [A-Za-z0-9._-]
  name: "Follow up open quotes",
  description: "Every weekday morning",
  graph, // ProcedureGraph: what the builder's "Export JSON" writes under `graph`
  enabled: true, // required; enabled = triggers armed immediately
});
// declared.status: "created" | "updated" | "unchanged" | "kept"
```

- Rule: a hash of the declared name, description, graph and enabled flag is kept.
  The procedure is refreshed only while its content still matches the last
  declaration; once anyone changed it (builder save, pause, resume, auto-disable)
  it is `"kept"` as is. Deleting it brings it back on the next call — pause it instead.
- Validated as "Import JSON", and as enabling in the builder when `enabled`:
  missing settings, no trigger, unknown template, a webhook route another enabled
  procedure answers on → rejects with an `Error` listing the problems, nothing
  stored. A node type not registered yet is only a warning (start order): the
  trigger arms when its type registers.
- Never write the module's tables directly: a row inserted behind its back is not
  armed and couples you to its schema.

## Gotchas

- Dependency placement: put the interface in `dependencies` only if your module
  requires the automation module to be present; use `optionalDependencies` if it
  merely offers nodes as a bonus (registrations become no-ops when unimplemented).
- `ListTriggerTypes` / `ListActionTypes` / `ListDataNodeTypes` / `InvokeProcedure`
  reject without an implementation — wrap in try/catch to branch on availability.
  (`GetInterfaceInstances` from `@antelopejs/interface-core` only reports
  connections for interfaces declared in `dependencies` or wired via
  `importOverrides`; with the recommended `optionalDependencies` setup it returns
  `[]` even when the automation module is loaded.)
- `TriggerType.cluster` is required, no default: `"singleton"` (fires once
  cluster-wide, leader-only, e.g. cron) or `"replicated"` (every instance activates,
  e.g. webhook). `activate` returns an opaque handle passed back to `deactivate`.
- `ExecutionCtx` has no tenant: procedures are platform-wide and a schedule or
  webhook has no tenant. A tenant-scoped action takes `tenantId` as an input
  (wired from the `tenantId` output of a DMS event trigger), defaulting to
  `DEFAULT_TENANT_ID` from `@antelopejs/interface-dms`, as the DMS's own actions do.
- A trigger type registered after the automation module armed its procedures
  (modules start in parallel, hot reloads) arms them on registration.
- When a module stops or hot-reloads, its triggers are deactivated as the core
  unregisters its types, while its context is still valid; a run on one of its
  steps ends `cancelled` (not `failed`, not caught by Try/Catch or Retry).
  Runs started by `emit` run in the automation module's context.
- `DataNodeType.evaluate` is synchronous and must be a pure transformation;
  `ActionType.execute` is async and receives an `ExecutionCtx` with a per-node
  `log(level, message, value?)`.
- `DataNodeType.configSchema` is editor-only: when set, the inspector renders it as
  editable fields instead of `inputSchema`, while data-in ports still derive from
  `inputSchema`; the config value is merged into the evaluate input.
- Namespace node ids as `"<module>.<node>"`; `icon` is an Iconify name
  (e.g. `i-lucide-bell`); schemas are plain JSON Schema objects, kept flat — one
  property per port.
- Providing this interface is not a normal consumer task: the implementation is the
  `@antelopejs/dms-automation` module.

## Deeper reference

See this package's README.md (installation, per-node-kind examples, conventions) and
`dist/index.d.ts` for the exact typed surface. The module side (procedures, config,
pages) is the `dms-automation` skill; the user guide's Extending page is
https://dms.antelopejs.com/docs/modules/automation/extending.
