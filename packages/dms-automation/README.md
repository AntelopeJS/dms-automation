# @antelopejs/dms-automation

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

The visual automation builder of the AntelopeJS DMS, under **Modules → Automation**. Author
procedures as node graphs (triggers, actions, flow and data nodes) started by schedules, webhooks,
manual runs or DMS events, and follow every run with its trace.

**Documentation:** [dms.antelopejs.com/docs/modules/automation](https://dms.antelopejs.com/docs/modules/automation)
(source in [`docs/`](./docs)).

## Installation

```bash
ajs project modules add @antelopejs/dms-automation
```

It runs on `@antelopejs/dms` 0.9 (`@antelopejs/interface-dms` 0.7) and
`@antelopejs/dms-frontend` 0.6. See the
[configuration](https://dms.antelopejs.com/docs/modules/automation/configuration) for run
retention, credential redaction, the HTTP request's private-network guard and clustering.

Other modules declare their own nodes through
[`@antelopejs/interface-dms-automation`](https://github.com/AntelopeJS/dms-automation/tree/main/packages/interface-dms-automation),
never through this package: see [Extending](https://dms.antelopejs.com/docs/modules/automation/extending).

The package ships a Claude Code skill, `skills/dms-automation`, declared in `antelopeJs.skills`.

## Vue frontend

The module registers `frontend-vue` through `AddFrontendModule` with the Vue 3 renderer. `dms.frontend.ts` declares the `DmsAutomation` component prefix, registers the Automation components, and a universal plugin registering the `automation:last-runs` cell display of the procedures table. The trigger and failed-step cells use the DMS `two_line` display over texts the server composes (`src/runtime/wording.ts`). `dms.frontend.build.ts` lists the folders the layer auto-imports (`app/composables`, `app/utils`). The generated Inertia application discovers the English and French locale files, while the host DMS provides shared composables and UI components.

The playground uses the published DMS and Inertia frontend packages. To build or typecheck the module frontend directly, first generate an Inertia workspace, set `DMS_FRONTEND_WORKSPACE` to its absolute path, then run:

```bash
pnpm --dir frontend-vue build
pnpm --dir frontend-vue typecheck
```

`pnpm test:frontend-registration` checks backend registration and configuration without starting database services or automation triggers.
