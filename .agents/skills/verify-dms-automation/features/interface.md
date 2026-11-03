---
covers:
  - packages/interface-dms-automation/src/**
  - packages/dms-automation/src/implementations/**
  - packages/dms-automation/src/runtime/declaredProcedures.ts
  - packages/dms-automation/src/runtime/runProcedure.ts
  - packages/dms-automation/src/runtime/registry.ts
  - packages/dms-automation/src/runtime/readiness.ts
  - packages/dms-automation/src/runtime/typeOrigin.ts
  - packages/dms-automation/src/routes/procedureRuns.ts
  - packages/dms-automation/src/runtime/builtins/nodes/action.ts
  - packages/dms-automation/src/runtime/resolveInputs.ts
docs:
  - packages/dms-automation/docs/5.extending.md
  - packages/interface-dms-automation/docs/1.index.md
  - packages/interface-dms-automation/README.md
---

# Interface

What another module gets from `@antelopejs/interface-dms-automation`: registering and removing trigger, action and data node types, listing them, starting a saved procedure from code with `InvokeProcedure` and `RunProcedure`, and shipping procedures as code with `DeclareProcedure`.

## Sub-features

- `registered-types-are-listed-with-their-definition`: `List*Types` and the library routes return every registered type with its module, name, description, icon, schemas and cluster mode, built-ins and the DMS's own included.
- `a-colliding-id-replaces-the-definition`: registering an id twice keeps one node, the second definition, for the three kinds.
- `a-removed-type-leaves-saved-graphs-and-run-history`: unregistering removes the declaration only; the saved graph and the history stay, and a run is refused (`RunProcedure`, 400 with the issue) or fails (`InvokeProcedure`) until the type is registered again.
- `a-type-unregistered-during-a-run-fails-its-step`: a step whose type disappears after the run started fails the run.
- `schema-defaults-apply-under-configured-values`: a property's `default` applies under the node's configured values, falsy defaults included, for actions and data nodes; a data node's config fields are merged into its input.
- `json-values-reach-the-run-unchanged`: payloads, outputs and logged values keep accents, CJK, emoji, nesting, `null` and `false`; a logged secret is stored.
- `invoke-procedure-rejects-404-and-400-and-returns-the-id-of-a-failed-run`: the 404 and 400 of `InvokeProcedure`, the id of a failed run, no idempotency key, the first manual trigger.
- `run-procedure-payload-defaults-to-the-newest-real-run-among-the-last-50`: the default payload, test runs excluded, the 50 run window, `triggerNodeId` filtering, an explicit `null`.
- `run-procedure-picks-the-trigger-and-answers-404-for-unknown-ones`: `triggerNodeId`, else the manual trigger, else the first trigger; 404 texts; the HTTP route answers the same.
- `run-procedure-answers-the-outcome-runs-a-paused-procedure-and-counts-in-health`: `{ runId, status, errorMessage? }`, a paused procedure runs, the run is an ordinary run that turns health to Failing.
- `run-procedure-refuses-a-graph-with-an-unknown-type-and-lists-the-issues`: the 400 with the `issues` list.
- `run-procedure-refuses-a-graph-with-no-trigger-or-a-missing-setting`: the documented 400 with `issues` for a graph with no trigger or a step missing its settings. Fails on the unmodified product, see `dms-automation-run-procedure-blocking-issues-not-refused`.
- `declare-procedure-accepts-the-documented-id-charset-and-length`: ids of letters, digits, `.`, `_`, `-`, 1 to 120 characters, taken as the procedure's id.
- `declare-procedure-validates-name-description-and-enabled`: names 1 to 200 characters once trimmed, descriptions up to 2000, `enabled` and `graph` required, every problem named and joined by `; `.
- `declare-procedure-validates-the-graph-as-import-and-enabling-do`: refusals for an enabled declaration (no trigger, missing setting, unknown template, a webhook route taken) and drafts with warnings for a disabled one.
- `declare-procedure-creates-once-and-keeps-what-users-did`: `created` then `kept`, the stored fields, a user's edit, pause and deletion.
- `declare-procedure-warns-about-a-duplicate-name-without-blocking`: the `nameTaken` warning.
- `an-enabled-declaration-arms-its-triggers-and-an-unknown-type-never-blocks`: arming at once, disabled arms nothing, unknown types are warnings and arm when registered.
- `a-procedure-declared-from-start-is-created-then-kept-across-restarts`: `DeclareProcedure` from `start()` over three boots.
- `a-declared-procedure-opens-in-the-builder-under-its-id`: `/modules/automation/builder?selected=<id>` shows it.
- `run-now-triggers-invoke-and-run-always-call-execute`: Run now, emit, `InvokeProcedure` and `RunProcedure` call `execute`, never `dryRun`.
- `a-test-run-follows-the-sideeffects-and-dryrun-declarations`: the table of test runs, the 409 until confirmed, `ctx.dryRun`.
- `an-action-resolves-with-an-object-or-nothing-and-a-throw-fails-the-step`: the result contract of actions, thrown values that are not Errors, a type disabled in the library.
- `a-data-node-evaluates-to-an-object-and-an-error-fails-the-step-that-reads-it`: the result contract of data nodes.
- `the-execution-context-carries-the-ids-of-the-run-and-the-node`: `procedureId`, `runId`, `nodeId`, `dryRun`, no tenant, no user.
- `unregistering-a-trigger-type-deactivates-its-handles-and-a-let-go-handle-starts-no-run`: `emit` starts runs, removing a type deactivates before the call returns, a let-go handle starts nothing, registering again re-arms, pausing deactivates.
- `an-arming-failure-is-not-a-registration-error-and-the-next-reconcile-retries`: `activate` throwing or never settling (10 s), `deactivate` throwing or never settling (10 s) and the retry.
- `interface-calls-wait-for-an-implementation-and-the-queue-holds-1000`: with no implementation the calls stay pending, 1,000 per function, the next rejects with `ProviderQueueFullError`.
- `the-interface-skill-says-what-the-calls-do-without-an-implementation-as-the-readme-does`: the shipped skill must describe the same behaviour as the README. Fails on the unmodified product, see `dms-automation-interface-skill-says-calls-reject-without-implementation`.

## How to get to it (user POV)

- A module depends on `@antelopejs/interface-dms-automation` and calls the functions from `start()`; the dashboard shows the result under Automation. The verification playground (`playground/src`) is that module.

## Driving it with dms-control

```bash
dms-control journey "$RUN" interface
```

## Gotchas

- The interface functions are backend calls. The playground serves them over HTTP under `/verify-auto` (`invoke`, `run`, `declare`, `types`, `types/define`, `types/register`, `types/unregister`, `emit`, `ledger`); `types/define` registers a node type built from JSON, so a journey can collide, replace, remove or register one late.
- The fixture's node types are registered by the `app` module: the library reports `module: "app"` for them. A type defined through `types/define` is registered from the API's request, so its `module` is not asserted.
- The ids of the stored run and `ctx.runId` differ: the context holds an id of the execution, the stored run gets its own after the run.
- `VERIFY_AUTO_DECLARE` makes the fixture call `DeclareProcedure` from `start()`: `withConfig(ctx, declareFile(ctx, declarations), ...)`.
- `hang-arm` and the slow `deactivate` each take 10 s on purpose; the journey that drives them runs about 40 s.
- `an-unparseable-stored-graph-is-refused-with-400-by-invoke-and-run`: a stored graph that is not JSON gives 400 from InvokeProcedure, RunProcedure and Run now, and stores no run.
