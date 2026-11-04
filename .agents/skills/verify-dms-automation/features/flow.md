---
covers:
  - packages/dms-automation/src/runtime/builtins/nodes/**
  - packages/dms-automation/src/runtime/executor.ts
  - packages/dms-automation/src/runtime/subwalk.ts
  - packages/dms-automation/src/runtime/topo.ts
  - packages/dms-automation/src/runtime/nodeKinds.ts
docs:
  - packages/dms-automation/docs/4.usage/3.builder.md
  - packages/dms-automation/docs/1.introduction.md
  - packages/dms-automation/docs/4.usage/5.library.md
---

# Flow

The flow nodes branch, loop and recover, and the helpers wait and name values: If, Switch, For each, For range, Parallel, Try / Catch, Retry, Delay and Set variable. Each journey builds a procedure through Import JSON, runs it with Run now and reads the run back through the run API, its logs and the fixture ledger, so every check is on the exact steps, branches, iterations, texts and timings the trace holds.

## Sub-features

- `if-follows-then-when-the-condition-is-true-and-else-otherwise`: 18 conditions (true, false, the texts false, FALSE, padded False, 0, empty and blank text, numbers, null, empty list and object, CJK text) each take the documented branch, and only that branch's step runs.
- `switch-follows-the-case-matching-the-value-or-default`: 19 values pick their case or default; numbers and booleans match by their text, objects and lists by their JSON text; case is significant; a value wired from a data node selects a case.
- `for-each-runs-its-body-once-per-item-of-a-list-in-order`: items in order with value and index (accents, CJK, emoji, mixed types), an empty list, and an input that is not a list warning with its type.
- `for-range-runs-its-body-for-each-number-of-a-range`: start, end excluded, step, defaults, counting down, fractions, text numbers, step 0, a start that is not a number, and the 10000 iteration limit (10000 runs, 10001 is refused).
- `parallel-starts-every-branch-at-once-and-waits-for-all-of-them`: overlapping sleeps, main after the last, a failing branch leaving the other to finish, the first failure reported, no branches.
- `try-catch-runs-catch-with-the-error-when-try-fails`: catch outputs, the caught warning, main after, a failing catch, nested tries, and seven kinds of thrown non-Error values.
- `retry-runs-its-body-up-to-max-attempts-then-goes-on-from-exhausted`: attempts counted with the flaky fixture action (N - 1 and N failures), the default of 3, fractions, text numbers, the minimum of 1, warnings, exhausted outputs.
- `delay-waits-the-set-time-then-the-flow-goes-on`: timings read from the fixture ledger and the step's duration.
- `set-variable-names-a-value-for-the-next-steps`: nine JSON values pass to the next step unchanged.
- `the-flow-nodes-publish-the-ports-the-builder-table-names`: the Flow and Helpers groups and each node's branches, data ports and defaults from `GET /node-kinds`.
- `flow-nodes-nest-and-a-failing-step-stops-the-run`: a loop with an If inside a Try / Catch, and a failing step that stops the run.
- `a-data-node-wired-from-a-loop-is-computed-for-every-iteration`: FAILS on the unmodified product (see the issue draft `dms-automation-data-node-stale-in-loop.md`).
- `the-library-lists-flow-and-helpers-with-their-wording`: the Library's Flow & helpers tab, in the browser.

## How to get to it (user POV)

- The Builder palette (groups Flow and Helpers) and the Library's Flow & helpers tab (`/modules/automation/library?tab=flow`).

## Driving it with dms-control

```bash
dms-control journey "$RUN" flow
```

## Gotchas

- Run now runs a disabled draft, so no journey enables its procedures.
- Retry's Max attempts below 1 and a negative Delay are refused by Run now (the issues carry `belowMinimum`), so the "at least 1" rule is checked through the refusal.
- Each loop run is read with the engine's trace: a long loop is bounded to 2000 log entries, so the 10000 iteration check reads the loop step's last output, not every iteration.
- The Delay checks allow 5 ms of timer rounding.
- `parallel-starts-every-branch-at-once-and-waits-for-all-of-them` reads timestamps the fixture's `verify.sleep` and `verify.tick` write in the ledger.
