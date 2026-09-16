---
name: dms-automation-interface
description: Provides the AntelopeJS DMS automation interface for declaring trigger, action and data node types from any module, plus listing node types and invoking procedures. Use when importing "@antelopejs/interface-dms-automation", when adding automation nodes to the DMS procedure editor, or when working with RegisterTriggerType, RegisterActionType, RegisterDataNodeType, ListTriggerTypes, ListActionTypes, ListDataNodeTypes, InvokeProcedure, TriggerType, ActionType, DataNodeType or ExecutionCtx.
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
`dist/index.d.ts` for the exact typed surface. Do not duplicate them here.
