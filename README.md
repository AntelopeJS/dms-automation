# dms-automation

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

The visual automation builder of the AntelopeJS DMS, and the contract other
modules use to plug their own nodes into it. Two packages, released separately:

| package | directory | what it is |
|---|---|---|
| [`@antelopejs/dms-automation`](./packages/dms-automation) | `packages/dms-automation` | the module: procedure editor, runtime, triggers, actions, data nodes |
| [`@antelopejs/interface-dms-automation`](./packages/interface-dms-automation) | `packages/interface-dms-automation` | the public contract, depended on by modules that declare automation nodes |

A module that only declares nodes depends on the **interface** package alone —
never on the implementation. The module depends on the interface through
`workspace:*`, which pnpm rewrites to the published version on pack, so the
interface is always released first.

## Working in this repository

The root holds the shared tooling — `oxlint.config.mts`, `oxfmt.config.mts` and
the base `tsconfig.json` / `tsconfig.build.json` that both packages extend — and
nothing publishable.

```bash
pnpm install              # the whole workspace, root included
pnpm lint                 # oxlint + oxfmt + the frontend-vue ESLint pass
pnpm typecheck            # both packages
pnpm build                # interface first, then the module
```

Each package can also be driven on its own with `pnpm --dir packages/<name> <script>`.
`packages/dms-automation/frontend-vue` and `packages/dms-automation/playground`
are separate projects with their own lockfiles.

## Releasing

Each package has its own manually dispatched workflow, and releasing one never
releases the other: run **Release DMS automation interface** first, then
**Release DMS automation module**, which refuses to start until the interface
version wired as `workspace:*` is resolvable on npmjs.
