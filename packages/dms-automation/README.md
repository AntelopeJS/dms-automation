<div align="center">

# @antelopejs/dms-automation

<a href="https://www.npmjs.com/package/@antelopejs/dms-automation"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/dms-automation?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/dms-automation?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a>
<a href="https://dms.antelopejs.com/docs/modules/automation"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

The visual automation builder of the AntelopeJS DMS.

</div>

![The Automation builder: a webhook trigger, a condition and two log actions on the canvas](https://raw.githubusercontent.com/AntelopeJS/dms-automation/main/packages/dms-automation/docs/images/builder.png)

## What it does

- Builds procedures as node graphs: triggers start a run, actions do the work, flow and data nodes branch, loop and shape values.
- Starts procedures from schedules, webhooks, manual runs or DMS events such as a user registering or a record being created.
- Keeps every run with its trace, shows where and why it failed, and re-runs it with its own payload.
- Shows the health of every procedure, with KPIs over 24 hours, 7 days or 30 days.
- Lets any module add its own nodes through [`@antelopejs/interface-dms-automation`](https://github.com/AntelopeJS/dms-automation/tree/main/packages/interface-dms-automation).

## Install

Run the AntelopeJS CLI from the root of a project that already loads `@antelopejs/dms`:

```bash
ajs project modules add @antelopejs/dms-automation
```

## Quick start

The module works without configuration. Restart the backend, then the frontend, and open **Modules → Automation**. The Overview offers three recipes to start from: **Forward a webhook**, **Send a scheduled digest** and **Run it on demand**.

To add a node from your own module, depend on the interface and register it in `start()`:

```ts
import { RegisterActionType } from "@antelopejs/interface-dms-automation";

RegisterActionType({
  id: "bakery.restock-order",
  name: "Place restock order",
  description: "Order an ingredient restock from a supplier",
  icon: "i-lucide-shopping-cart",
  inputSchema: { type: "object", properties: { ingredient: { type: "string" } } },
  outputSchema: { type: "object", properties: { ordered: { type: "boolean" } } },
  async execute(input, ctx) {
    ctx.log("info", "placing restock order", input);
    return { ordered: true };
  },
});
```

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                                     | Supported                                                            | Tested with |
| ------------------------------------------- | -------------------------------------------------------------------- | ----------- |
| `@antelopejs/interface-api`                 | `>=0.0.15 <1.0.0`                                                    | —           |
| `@antelopejs/interface-api-util`            | `>=0.1.3 <1.0.0`                                                     | —           |
| `@antelopejs/interface-core`                | `>=0.2.4 <1.0.0`                                                     | —           |
| `@antelopejs/interface-data-api`            | `>=0.4.0 <1.0.0`                                                     | —           |
| `@antelopejs/interface-database`            | `file:../../.campaign/tgz/antelopejs-interface-database-4939b45.tgz` | —           |
| `@antelopejs/interface-database-decorators` | `>=0.1.10 <1.0.0`                                                    | —           |
| `@antelopejs/interface-dms`                 | `>=0.9.0 <1.0.0`                                                     | —           |
| `@antelopejs/interface-dms-automation`      | `>=0.5.0 <0.6.0`                                                     | —           |
| `@antelopejs/interface-redis`               | `>=0.0.9 <1.0.0`                                                     | —           |

<!-- antelopejs-docs-compat:end -->

Module 0.5 uses interface 0.3, including `DeclareProcedure` and `RunProcedure`. Module 0.4 uses interface 0.2.

| Package | Version |
| --- | --- |
| `@antelopejs/dms` | `>=0.11.0 <1.0.0` |
| `@antelopejs/interface-dms` | `>=0.9.0 <1.0.0` |
| `@antelopejs/dms-frontend` (renderer) | `>=0.6.0 <0.7.0` |
| `@antelopejs/interface-dms-automation` | `>=0.5.0 <0.6.0` |
| API provider | `@antelopejs/api`, for webhooks |
| Database | an `@antelopejs/interface-database` implementation |

On DMS 0.8, use `@antelopejs/dms-automation` 0.3. Running several instances needs `@antelopejs/interface-redis`: see [Clustering](https://dms.antelopejs.com/docs/modules/automation/configuration#clustering).

## Documentation

- [Introduction](https://dms.antelopejs.com/docs/modules/automation/introduction)
- [Installation](https://dms.antelopejs.com/docs/modules/automation/installation)
- [Configuration](https://dms.antelopejs.com/docs/modules/automation/configuration)
- [Usage](https://dms.antelopejs.com/docs/modules/automation/usage/overview)
- [Extending](https://dms.antelopejs.com/docs/modules/automation/extending)
- [FAQ](https://dms.antelopejs.com/docs/modules/automation/faq)

The guide's sources live in [`packages/dms-automation/docs`](https://github.com/AntelopeJS/dms-automation/tree/main/packages/dms-automation/docs). The module ships the `dms-automation` Claude Code skill in [`packages/dms-automation/skills`](https://github.com/AntelopeJS/dms-automation/tree/main/packages/dms-automation/skills), declared under `antelopeJs.skills`.

## Contributing

This package lives in the [`AntelopeJS/dms-automation`](https://github.com/AntelopeJS/dms-automation) pnpm workspace, next to `@antelopejs/interface-dms-automation`. Read [CONTRIBUTING.md](https://github.com/AntelopeJS/dms-automation/blob/main/CONTRIBUTING.md) and the [repository README](https://github.com/AntelopeJS/dms-automation#contributing) for the development commands.

## License

[Apache-2.0](./LICENSE)
