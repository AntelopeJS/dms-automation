# dms-automation

## Layout

A pnpm workspace with two published packages. The root holds the tool configs and the CI workflows.

| Path                                      | What it is                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/interface-dms-automation`       | `@antelopejs/interface-dms-automation`, the contract other modules use to declare their nodes |
| `packages/dms-automation`                 | `@antelopejs/dms-automation`, the module that implements it                                 |
| `packages/dms-automation/frontend-vue`    | The Vue layer. oxlint skips it and ESLint lints it. oxfmt gates everything but `.vue`; its own `format` runs Prettier over all of it, so run the root `pnpm run format` after it |
| `packages/dms-automation/playground`      | A standalone project with its own lockfile, outside the workspace install                  |

Run a package script from its own directory: `pnpm --dir packages/dms-automation <script>`.

## Versioning

- The module implements the interface, so it depends on it through `>=<interface version> <0.<minor + 1>.0`. A breaking interface minor never reaches a module that does not implement it. Any other module depends on the interface alone, with a wide range.
- Release the interface before the module: the module's range is floored at the interface version in the tree. Both release jobs live in `release.yml`.

## What `pnpm run checks` does not run

- The docs check runs in CI only (`docs-files` in `.github/workflows/ci.yml`), as does `pnpm --dir packages/interface-dms-automation check:exports`, which needs the built `dist`.
- The frontend build and typecheck need a generated Inertia workspace: set `DMS_FRONTEND_WORKSPACE` to its absolute path, then run `pnpm --dir packages/dms-automation/frontend-vue build` or `typecheck`.
- The playground needs MongoDB, then `pnpm --dir packages/dms-automation/playground install --ignore-workspace`, a root `pnpm run build`, and in `packages/dms-automation/playground`: `pnpm run build` and `pnpm exec ajs project modules install`. `.agents/playground` runs that sequence, and the `dms-auto-play-back` orb service runs it before `pnpm dev`.
- `pnpm --dir packages/dms-automation knip:all` also reports unused files and exports.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

CI runs `pnpm run checks` in full on every pull request and reports what failed. The commit hook formats and lints the staged files. Locally, run only the fast check for what you touched:

- `pnpm run typecheck` after you change types or signatures.
- `pnpm exec oxlint <files>` and `pnpm exec oxfmt <files>` on the files you changed.
- One test file, not the suite. In a module that tests with `ajs module test`: `pnpm run build`, then `pnpm exec ajs module test . -f dist/<path>.test.js`.

Prove a change works with the verification skill in [`.agents/skills/verify-dms-automation/SKILL.md`](.agents/skills/verify-dms-automation/SKILL.md) before you call it done.

### Comments

Say it in code: a constraint in a type, a lint rule or a test, a public item's contract in TSDoc. Other comments are lint directives naming their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, and license or tool directives. A reason states what the code does now.

### Tests

Each test names the wrong implementation it fails on, or is deleted. Drive behaviour through the public interface. An invariant over many files is a lint rule.

### Review

No tool checks these:

- A type guard checks the nested elements and values it claims.
- A no-upward import rule rejects same-tier peers; probe it with an import.
- A finding only an evasion or a patched internal can trigger goes under Attention and never blocks.

### Suppressions

`guardrails.suppressions.json` caps lint directives, `@ts-expect-error`, `SAFETY:` comments and rules a lint config turns off. Over a cap, fix the code or remove another suppression of that kind; only the operator raises a number. After removing suppressions, run `pnpm run suppressions:update` and commit the file.

<!-- antelopejs-guardrails:end -->
