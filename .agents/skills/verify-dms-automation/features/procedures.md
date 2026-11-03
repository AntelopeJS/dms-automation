---
covers:
  - packages/dms-automation/src/routes/procedures.ts
  - packages/dms-automation/src/routes/procedureSchemas.ts
  - packages/dms-automation/src/routes/procedureChecks.ts
  - packages/dms-automation/src/routes/procedureRuns.ts
  - packages/dms-automation/src/routes/deleteConfirm.ts
  - packages/dms-automation/src/routes/requests.ts
  - packages/dms-automation/src/stats/health.ts
  - packages/dms-automation/src/data/procedures-table.ts
  - packages/dms-automation/src/runtime/graphVersion.ts
  - packages/dms-automation/src/data/procedures-query.ts
  - packages/dms-automation/src/routes/graphSchema.ts
  - packages/dms-automation/src/routes/zodJson.ts
  - packages/dms-automation/src/runtime/graphIssues.ts
  - packages/dms-automation/src/runtime/validate.ts
docs:
  - packages/dms-automation/docs/4.usage/2.procedures.md
  - packages/dms-automation/skills/dms-automation/SKILL.md
---

# Procedures (API)

The lifecycle of a procedure through `/api/automation/procedures`: create, import, export, duplicate, save, pause and resume, enable refusals, states, dismiss, delete, last payload, triggers, summary and list.

## Sub-features

- `new-procedure-makes-a-disabled-draft-with-its-trigger-in-place`: webhook, schedule and manual starters, read back through GET, summary and export.
- `new-webhook-procedure-takes-its-path-from-the-name`: slug, accents, CJK fallback, 40 characters, taken paths get -2, -3.
- `new-procedure-refuses-what-the-limits-forbid`: name 1-200 trimmed, description 2000, 400 invalid body naming the field.
- `a-taken-name-warns-and-is-created-anyway`: nameTaken warning on new, import and validate.
- `import-json-creates-a-disabled-draft-from-an-export` and `import-json-refuses-what-is-not-an-exported-procedure`: export/import round trip and refusals.
- `duplicate-makes-a-disabled-copy-with-free-webhook-paths`: `<name> (copy)`.
- `saving-moves-the-revision-and-the-version-only-when-a-run-would-differ`: PUT /:id, 409 stale, rename of runs, pause by save, body validation.
- `pause-and-resume-change-only-whether-it-is-enabled` and `enabling-is-refused-while-the-graph-cannot-run`: PUT /:id/enabled and its refusals.
- `states-follow-the-runs-as-the-docs-define-them`, `last-runs-draws-twelve-runs-and-success-is-the-share-of-successes`, `dismiss-hides-a-degraded-procedure-until-it-fails-again`.
- `delete-confirmation-is-worded-for-the-procedure` and `delete-takes-the-graph-and-keeps-the-runs` (the data-door containment named in verify.config.ts).
- `run-now-sends-the-payload-of-the-last-real-call`, `triggers-are-listed-in-words-with-the-next-schedule-time`, `validate-lists-the-problems-of-a-draft-graph`.
- `the-list-pages-newest-first-and-refuses-bad-pages`, `the-runs-of-a-procedure-list-newest-first-and-page`.
- `routes-the-module-does-not-serve-answer-404-and-change-nothing`: wrong methods through raw.

## How to get to it (user POV)

- Procedures page and builder; API `/api/automation/procedures`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" procedures
```

## Gotchas

- Statuses in run rows are `ok`/`error`, not succeeded/failed.
- A wrong method is the router's plain `Not Found`, not the module's JSON 404.
- Test routes (`/test`, `/test-effects`) are driven by the `test-runs` feature.
