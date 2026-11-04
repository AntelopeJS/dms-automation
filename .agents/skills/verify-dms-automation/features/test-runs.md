---
covers:
  - packages/dms-automation/src/routes/procedures.ts
  - packages/dms-automation/src/routes/procedureRuns.ts
  - packages/dms-automation/src/runtime/sideEffects.ts
  - packages/dms-automation/src/runtime/runProcedure.ts
  - packages/dms-automation/src/runtime/builtins/nodes/action.ts
  - packages/dms-automation/src/types/runLog.ts
docs:
  - packages/dms-automation/docs/4.usage/3.builder.md
  - packages/dms-automation/docs/5.extending.md
  - packages/dms-automation/docs/4.usage/4.runs.md
  - packages/dms-automation/docs/6.faq.md
  - packages/interface-dms-automation/docs/1.index.md
---

# Test runs

**Test run** tries a draft without saving it: actions with a `dryRun` are simulated, actions that declare `sideEffects: false` run as they are, and every other action acts for real once the user confirms. A test is kept with its trace and never counts. **Run now**, triggers, `InvokeProcedure` and `RunProcedure` always execute.

## Sub-features

- `a-test-run-asks-before-it-acts-for-real`: a draft with a step that acts for real is refused with 409 and the list of steps until `confirmRealEffects` is true; nothing runs before; the confirmed test runs it with `ctx.dryRun` true.
- `test-effects-lists-the-steps-a-test-would-run-for-real`: the listing, in graph order, with type names and step names.
- `a-test-run-calls-dry-run-instead-of-execute-and-sets-ctx-dry-run`: `dryRun` instead of `execute`, the `Simulated (test run): no effect` log, `sideEffects: false` winning, `ctx.dryRun`, and Run now, a trigger, `InvokeProcedure` and `RunProcedure` calling `execute`.
- `a-test-run-is-kept-as-a-test-run-of-the-draft-and-never-counts`: the draft's graph is run and kept, no saved version, the saved procedure untouched, a failing test never changes a state, a KPI, Needs attention or the health banner; Run now counts.
- `a-test-run-refuses-what-the-builder-would-not-let-through`: empty or broken drafts, unknown trigger node, missing graph, unknown procedure, other HTTP methods on the routes; which trigger a test starts from.
- `the-test-payload-comes-from-the-last-real-run`: `last-payload` and Run now default to the trigger's last real payload, tests excluded.
- `a-test-run-can-be-run-again-and-is-stored-as-a-test`: re-running a test runs its kept draft again as a test, and its confirmation names the steps acting for real.
- `the-builder-asks-before-it-tests-for-real-and-prefills-the-test-payload`: in the Builder, Test run lists the steps in Test with real effects?, Cancel runs nothing, Test for real runs the draft and the Test run tab lists the steps, a safe draft tests at once, and the Test payload is prefilled from the last real call.

## How to get to it (user POV)

- Builder › Test run (`Ctrl Enter`) and Run now, Procedures › Run now, Run history › Re-run.

## Driving it with dms-control

```bash
dms-control journey "$RUN" test-runs
```

## Gotchas

- The fixture actions `verify.effect` (dryRun, side effects assumed), `verify.effect-nodry` (neither member), `verify.effect-pure` (dryRun and `sideEffects: false`), `verify.context` and `verify.tick` write the ledger (`GET /verify-auto/ledger`), the only place a step's `ctx.dryRun` and the call it received are visible.
- The builder's Run now dialog and its unsaved-changes question belong to the `builder` feature; the Test with real effects? dialog is driven here.
