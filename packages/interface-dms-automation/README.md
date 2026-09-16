# @antelopejs/interface-dms-automation

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

AntelopeJS interface for the DMS automation module. It lets **any module** declare
automation node types — triggers, actions and data nodes — that become available in the
automation procedure editor, without depending on the automation module implementation.

The implementation is provided by
[`@antelopejs/dms-automation`](https://github.com/AntelopeJS/dms-automation),
which declares `implements: ["@antelopejs/interface-dms-automation"]`.

## Installation

```bash
pnpm add @antelopejs/interface-dms-automation
```

- Put it in `dependencies` if your module **requires** the automation module to be
  present in the project (project startup fails otherwise).
- Put it in `optionalDependencies` if your module merely **offers** automation nodes:
  when no module implements the interface, registrations are inert no-ops and your
  module keeps working. This is the recommended setup for DMS modules that ship
  nodes as a bonus feature.

```json
// package.json
{
  "optionalDependencies": {
    "@antelopejs/interface-dms-automation": ">=0.0.1 <1.0.0"
  }
}
```

## Declaring nodes from a module

Register node types at module `start()` (or any time — registrations made before the
automation module attaches are queued and replayed automatically, so load order does
not matter).

### Action node

An action is an async step in a procedure. `inputSchema` / `outputSchema` are JSON
Schemas; they drive the editor's ports and validation.

```ts
import { RegisterActionType, UnregisterActionType } from "@antelopejs/interface-dms-automation";

export function start(): void {
  RegisterActionType({
    id: "my-module.notify",
    name: "Send notification",
    description: "Send a notification to a user",
    icon: "i-lucide-bell",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string" },
        message: { type: "string" },
      },
      required: ["userId", "message"],
    },
    outputSchema: {
      type: "object",
      properties: { delivered: { type: "boolean" } },
    },
    async execute(input: unknown, ctx) {
      const { userId, message } = input as { userId: string; message: string };
      ctx.log("info", `notifying ${userId}`);
      // ... do the work ...
      return { delivered: true };
    },
  });
}

export function stop(): void {
  UnregisterActionType("my-module.notify");
}
```

### Trigger node

A trigger starts a procedure run. `cluster` is required and states the firing
semantics in multi-instance deployments:

- `"singleton"` — must fire exactly once cluster-wide; only the elected leader
  activates it (e.g. cron).
- `"replicated"` — every instance activates it; the load balancer already routes
  each event to exactly one instance (e.g. webhook).

```ts
import { RegisterTriggerType } from "@antelopejs/interface-dms-automation";

RegisterTriggerType({
  id: "my-module.record-created",
  name: "Record created",
  description: "Fires when a record is created in my-module",
  icon: "i-lucide-database",
  cluster: "replicated",
  configSchema: {
    type: "object",
    properties: { table: { type: "string" } },
    required: ["table"],
  },
  outputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
  },
  async activate(config: unknown, emit) {
    const off = myEvents.on("created", (record) => emit({ id: record.id }));
    return off; // opaque handle, given back to deactivate()
  },
  async deactivate(off: unknown) {
    (off as () => void)();
  },
});
```

### Data node

A data node is a pure, synchronous transformation used to wire values between nodes.

```ts
import { RegisterDataNodeType } from "@antelopejs/interface-dms-automation";

RegisterDataNodeType({
  id: "my-module.slugify",
  category: "String",
  name: "Slugify",
  description: "Turn a string into a URL-safe slug",
  icon: "i-lucide-link",
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
  },
  outputSchema: {
    type: "object",
    properties: { slug: { type: "string" } },
  },
  evaluate(input: unknown) {
    const { value } = input as { value: string };
    return { slug: value.toLowerCase().replace(/[^a-z0-9]+/g, "-") };
  },
});
```

## Querying and invoking

These interface functions require an implementation to be present; with no
implementation the returned promise rejects (registrations, by contrast, are
always safe to call).

```ts
import { InvokeProcedure, ListActionTypes } from "@antelopejs/interface-dms-automation";

const actions = await ListActionTypes();
const runId = await InvokeProcedure(procedureId, { some: "payload" });
```

To branch on availability instead of catching a rejection, check
`GetInterfaceInstances("@antelopejs/interface-dms-automation")` from
`@antelopejs/interface-core`.

## Conventions

- Namespace node ids with your module name: `"<module>.<node>"` (e.g. `dms.page-published`).
- `icon` is an Iconify name rendered by the editor (e.g. `i-lucide-bell`).
- Schemas are plain JSON Schema objects; keep them flat — one property per port.
