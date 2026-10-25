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
- Release the interface first (**Release DMS automation interface**), then the module. The module workflow refuses to start until the interface version in the tree is on npm, and the module's range is floored at that version.

## What `pnpm run checks` does not run

- The docs check runs in CI only (`docs-files` in `.github/workflows/ci.yml`), as does `pnpm --dir packages/interface-dms-automation check:exports`, which needs the built `dist`.
- The frontend build and typecheck need a generated Inertia workspace: set `DMS_FRONTEND_WORKSPACE` to its absolute path, then run `pnpm --dir packages/dms-automation/frontend-vue build` or `typecheck`.
- The playground needs MongoDB, a root `pnpm run build`, then in `packages/dms-automation/playground`: `pnpm install --ignore-workspace`, `pnpm run build` and `pnpm exec ajs project modules install`. `.agents/playground` runs that sequence, and the `dms-auto-play-back` orb service runs it before `pnpm dev`.
- `pnpm --dir packages/dms-automation knip:all` also reports unused files and exports. Confirm each finding before you remove it.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, ratchet, and sync, and prints only what failed. The change is done when it prints no failure.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Debt

`guardrails.ratchet.json` records the lint findings and oversize files this repository already had. Its numbers only go down. After you remove debt, run `pnpm run ratchet:update` and commit the lowered file. A rule listed there is off for `oxlint`. The ratchet counts it instead, and the pre-commit hook rejects it on every line you add.

### What enforces what

| Rule                                                                           | Enforced by                               |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Formatting                                                                     | oxfmt                                     |
| Lint findings are errors; no rule warns                                        | oxlint preset                             |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                  |
| Every test asserts                                                             | `antelopejs/require-assertion`            |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`          |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`  |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test` |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`       |
| Files ≤ 20,000 bytes, tests included                                           | `antelopejs-check-size` (pre-commit)      |
| Existing debt only shrinks                                                     | `antelopejs-ratchet`                      |
| Types check                                                                    | `tsc` (pre-push)                          |
| No dead files, exports, or dependencies                                        | knip                                      |
| Managed files match the pack                                                   | `antelopejs-sync --check`                 |
| A test names the wrong implementation it catches                               | review; no tool                           |

<!-- antelopejs-guardrails:end -->
