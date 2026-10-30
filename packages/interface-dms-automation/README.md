<div align="center">

# @antelopejs/interface-dms-automation

<a href="https://www.npmjs.com/package/@antelopejs/interface-dms-automation"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/interface-dms-automation?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/interface-dms-automation?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a>
<a href="https://dms.antelopejs.com/docs/modules/automation/extending"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

The AntelopeJS interface to add triggers, actions and data nodes to the DMS automation builder.

</div>

## What it does

- Declares trigger, action and data node types from any module: `RegisterTriggerType`, `RegisterActionType`, `RegisterDataNodeType` and their `Unregister*` counterparts.
- Queues registrations made before the automation module attaches and replays them, so load order does not matter.
- Lists the available node types (`ListTriggerTypes`, `ListActionTypes`, `ListDataNodeTypes`) and starts a procedure from code: `InvokeProcedure` from its manual trigger, `RunProcedure` from any trigger, as Run now in the builder.
- Ships procedures as code (`DeclareProcedure`): created once under a stable id, never touched again.
- Keeps your module independent of the implementation, [`@antelopejs/dms-automation`](https://www.npmjs.com/package/@antelopejs/dms-automation).

## Install

Add the interface to the module that declares nodes:

```bash
pnpm add @antelopejs/interface-dms-automation
```

Move it to `optionalDependencies` when your nodes are a bonus: with no implementation loaded, registrations wait for attachment and your module keeps working. Keep it in `dependencies` when your module needs automation to run. Use a wide consumer range, such as `>=0.3.0 <1.0.0`, so package managers can deduplicate. The implementing module caps its own dependency below the next interface minor instead.

## Quick start

Register in `start()`, unregister in `stop()`:

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
    async execute(input, ctx) {
      ctx.log("info", "notifying", input);
      return { delivered: true };
    },
  });
}

export function stop(): void {
  UnregisterActionType(NOTIFY_ID);
}
```

Triggers also take a `cluster` mode: `"singleton"` fires on the elected leader only (schedules), `"replicated"` on every instance (webhooks). Namespace node ids as `<module>.<node>` and keep schemas flat, one property per port.

## Compatibility

Interface 0.3 requires `@antelopejs/dms-automation >=0.5.0` for its complete contract, including `DeclareProcedure` and `RunProcedure`. Module 0.4 implements interface 0.2. The interface declares this peer dependency:

<!-- antelopejs-docs-compat:start -->

| Package                      | Supported        | Tested with |
| ---------------------------- | ---------------- | ----------- |
| `@antelopejs/interface-core` | `>=0.2.4 <1.0.0` | —           |

<!-- antelopejs-docs-compat:end -->

`InvokeProcedure`, `RunProcedure` and the `List*Types` functions reject when no implementation is loaded; check `GetInterfaceInstances("@antelopejs/interface-dms-automation")` from `@antelopejs/interface-core` to branch on availability instead.

## Documentation

- [Consumer reference](./docs/1.index.md): node contracts, lifecycle, clustering, invocation and failures
- [Extending the automation module](https://dms.antelopejs.com/docs/modules/automation/extending): node kinds, required members, running a procedure from code
- [Automation module guide](https://dms.antelopejs.com/docs/modules/automation)

The package also ships the `dms-automation-interface` Claude Code skill in [`skills/`](https://github.com/AntelopeJS/dms-automation/tree/main/packages/interface-dms-automation/skills), declared under `antelopeJs.skills`.

## Contributing

This package lives in the [`AntelopeJS/dms-automation`](https://github.com/AntelopeJS/dms-automation) pnpm workspace, next to the module that implements it. Read [CONTRIBUTING.md](https://github.com/AntelopeJS/dms-automation/blob/main/CONTRIBUTING.md) and the [repository README](https://github.com/AntelopeJS/dms-automation#contributing) for the development commands. Release this package before the module that implements it.

## License

[Apache-2.0](./LICENSE)
