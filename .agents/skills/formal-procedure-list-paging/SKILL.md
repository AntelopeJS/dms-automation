---
name: formal-procedure-list-paging
description: Property check (fast-check) of the procedure list of @antelopejs/dms-automation, GET /api/automation/procedures, over any mix of readable and unreadable stored procedures and any page size. Use when a change touches ProceduresController.list in packages/dms-automation/src/routes/procedures.ts, readable() or parseGraphSafe, ProcedureModel.newestFirst in src/db/models/procedure.model.ts, or pageParams in src/routes/requests.ts, or needs proof that the builder, which reads pages until the first short one, sees every procedure.
---

# Property check: procedure list paging past unreadable graphs

`GET /api/automation/procedures` leaves out a procedure whose stored graph cannot be read. The builder (`useEditorLoad`) reads pages of 200 until the first short one, so a page that comes back short because of a dropped row hides every later procedure, and a `total` that counts the dropped row misreports the library.

The property, for any stored procedures with distinct update times, each readable or not (a graph that is not JSON, or a node whose label is a number), and any page size from 1 to 12:

- the pages read from 0 on, concatenated, hold every readable procedure exactly once, newest first;
- `total` on every page equals the readable count;
- every page before the last holds `limit` rows, the last holds the rest, and the page after it is empty.

fast-check generates the rows and shrinks a failure to the smallest mix. The check drives the compiled route, `ProceduresController.prototype.list`, over a stubbed procedure table, as `tests/stored-json.test.cjs` does, so it runs the code the module serves. A bound is not a proof: it samples 300 cases per run, with at most 30 rows.

## Run it

From `packages/dms-automation`:

```sh
pnpm run build
node --test tests/procedure-list-paging.test.cjs
```

`pnpm test` and `pnpm run test:unit` run it, so `pnpm run checks` and the CI `ci` job cover it. A failure prints the seed and the shrunk counterexample, `[rows, limit]`, where each row is its update time and its stored graph.

## When it fails

A failure is a real bug unless the contract changed on purpose. Read the counterexample first: the rows name the mix, the assertion message names the page and the rule (`total, page N`, `rows on page N`, or the final list of ids). If the route's contract changes on purpose, change the property and this file together. Never loosen a rule to make it pass.

## Confirmed to fail

Each edit was applied to the built module with the check otherwise untouched, and the check exited 1:

| Scratch change | Result |
| --- | --- |
| The route before #205 (`ProcedureModel.list` pages in the database, then `readable` drops rows) | `total, page 0`: `2 !== 1`, shrunk to two rows, one unreadable, page size 1 |
| `ProcedureModel.newestFirst()` orders `updated_at` ascending | fails on the final list of ids, shrunk to two readable rows, page size 1 |

## Coverage record

| Property | Code |
| --- | --- |
| rows read newest first | `ProcedureModel.newestFirst` (src/db/models/procedure.model.ts) |
| unreadable rows left out | `readable`, `parseGraphSafe` (src/routes/procedures.ts, src/types/graph.ts) |
| `total` and the page cut | `ProceduresController.list`, `pageParams` (src/routes/procedures.ts, src/routes/requests.ts) |

The sync commit is `bac9c2a` on AntelopeJS/dms-automation `next`, which has the fix of #205. After a change to the code above, confirm the property still describes it, then move the sync commit forward.

## What it leaves out

- The database: the stub orders and returns rows as the route asks. A driver that sorts differently is outside this check.
- A page size above the largest page served, which `pageParams` reads as the largest.
- Rows with equal update times, whose order is not specified.
- The builder's own paging loop (`useEditorLoad`), which is covered by reading the pages the way it does.
