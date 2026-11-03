<div align="center">

# `@antelopejs/interface-dms-automation`

<a href="https://www.npmjs.com/package/@antelopejs/interface-dms-automation"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/interface-dms-automation?style=for-the-badge&labelColor=000000&color=000000" data-illustration></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/interface-dms-automation?style=for-the-badge&labelColor=000000&color=000000" data-illustration></a>
<a href="https://discord.gg/g4pFt6eXqu"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" data-illustration></a>
<a href="https://dms.antelopejs.com/docs/modules/automation/extending"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" data-illustration></a>

The AntelopeJS interface to add triggers, actions and data nodes to the DMS automation builder.

</div>

## What it does

- Declares trigger, action and data node types from any module, with `RegisterTriggerType`, `RegisterActionType`, `RegisterDataNodeType` and their `Unregister*` counterparts.
- Queues registrations made before the automation module attaches and replays them, so load order does not matter.
- Lists the available node types with `ListTriggerTypes`, `ListActionTypes` and `ListDataNodeTypes`.
- Starts a procedure from code. `InvokeProcedure` starts it from its manual trigger. `RunProcedure` starts it from any trigger, as **Run now** in the builder does.
- Ships procedures as code with `DeclareProcedure`. The automation module creates the procedure once under a stable ID and never changes it after that.
- Keeps your module independent of the implementation, [`@antelopejs/dms-automation`](https://www.npmjs.com/package/@antelopejs/dms-automation).

## Install

Add the interface to the module that declares nodes:

```bash
pnpm add @antelopejs/interface-dms-automation
```

If your module works without automation, move the interface to `optionalDependencies`. With no implementation loaded, registrations wait for one to attach, and your module keeps working. If your module needs automation to run, keep the interface in `dependencies`. Use a wide consumer range, from the interface release you build against up to `<1.0.0`, so package managers can deduplicate it. The implementing module caps its own dependency below the next interface minor instead.

## Quick start

Register each node in `start()` and unregister it in `stop()`:

```ts
import { RegisterActionType, UnregisterActionType } from "@antelopejs/interface-dms-automation";

const NOTIFY_ID = "my-module.notify";

export function start(): void {
  RegisterActionType({
    id: NOTIFY_ID,
    name: "Send notification",
    description: "Send a notification to a user",
    icon: "i-lucide-bell",
    inputSchema: {
      type: "object",
      properties: { userId: { type: "string" }, message: { type: "string" } },
      required: ["userId", "message"],
    },
    outputSchema: { type: "object", properties: { delivered: { type: "boolean" } } },
    async execute(input: { userId: string; message: string }, ctx) {
      ctx.log("info", "notifying", input);
      return { delivered: true };
    },
  });
}

export function stop(): void {
  UnregisterActionType(NOTIFY_ID);
}
```

A trigger also declares a required `cluster` mode. A `"singleton"` trigger, such as a schedule, fires on the elected leader only. A `"replicated"` trigger, such as a webhook, fires on every instance. Namespace node IDs as `<module>.<node>`, and keep schemas flat, with one property per port.

## Compatibility

The compatibility block of the [module README](../dms-automation/README.md#compatibility) lists the interface range that each `@antelopejs/dms-automation` release implements. The interface declares this peer dependency:

<!-- antelopejs-docs-compat:start -->

| Package                      | Supported        | Tested with                                                      |
| ---------------------------- | ---------------- | ---------------------------------------------------------------- |
| `@antelopejs/interface-core` | `>=0.2.4 <1.0.0` | `file:../../.campaign/tgz/antelopejs-interface-core-f7df541.tgz` |

<!-- antelopejs-docs-compat:end -->

`InvokeProcedure`, `RunProcedure`, `DeclareProcedure` and the `List*Types` functions queue their call until an implementation attaches. With no implementation loaded, the returned promise stays pending. By default, each function queues at most 1,000 calls, and the next one rejects with `ProviderQueueFullError`. A queued call whose calling module stopped rejects with `ModuleContextInvalidatedError` when an implementation attaches. To branch on availability, check `GetInterfaceInstances("@antelopejs/interface-dms-automation")` from `@antelopejs/interface-core`.

## Documentation

- [Consumer reference](./docs/1.index.md) covers node contracts, lifecycle, clustering, invocation and failures.
- [Extending the automation module](https://dms.antelopejs.com/docs/modules/automation/extending) covers node kinds, required members and running a procedure from code.
- The [automation module guide](https://dms.antelopejs.com/docs/modules/automation) covers the rest of the module.

The package also ships the `dms-automation-interface` Claude Code skill in [`skills/`](https://github.com/AntelopeJS/dms-automation/tree/main/packages/interface-dms-automation/skills), declared under `antelopeJs.skills`.

## Contributing

This package lives in the [`AntelopeJS/dms-automation`](https://github.com/AntelopeJS/dms-automation) pnpm workspace, next to the module that implements it. Read [CONTRIBUTING.md](https://github.com/AntelopeJS/dms-automation/blob/main/CONTRIBUTING.md) and the [repository README](https://github.com/AntelopeJS/dms-automation#contributing) for the development commands. Release this package before the module that implements it.

## License

[Apache-2.0](./LICENSE)
