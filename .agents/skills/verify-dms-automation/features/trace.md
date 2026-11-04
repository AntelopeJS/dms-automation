---
covers:
  - packages/dms-automation/src/routes/runs.ts
  - packages/dms-automation/src/runtime/trace.ts
  - packages/dms-automation/src/pages/trace.ts
  - packages/dms-automation/frontend-vue/app/components/RunTrace.vue
  - packages/dms-automation/frontend-vue/app/components/Run/**
  - packages/dms-automation/frontend-vue/app/composables/useRunActions.ts
docs:
  - packages/dms-automation/docs/4.usage/4.runs.md
  - packages/dms-automation/docs/6.faq.md
---

# Trace

The trace of one run at `/modules/automation/trace?run=<id>`, and Re-run with the same payload: refusals, confirmation wording, and what runs.

## Sub-features

- `the-trace-header-and-figures-describe-a-succeeded-run`: header, Previous run and Next run, the four figures, the tabs with counts, comparison.
- `a-failed-run-names-the-step-how-long-how-often-the-error-and-the-last-success`: failure card, streak, usual duration, last success, skipped steps, Open this step.
- `the-trace-tabs-show-steps-path-only-payload-and-logs`: Steps, Path only, Payload, Logs, Open in builder.
- `a-run-of-an-older-version-and-a-re-run-are-bannered-in-the-trace`: older-version banner, re-run banner and Open the original run.
- `a-test-run-trace-disables-debug-in-builder-and-open-this-step`: disabled buttons and hint, Draft tile, a draft that was not kept.
- `the-trace-says-when-no-run-is-given-the-run-is-unknown-or-its-procedure-deleted`: the three empty states.
- `a-re-run-runs-the-current-saved-graph-with-the-stored-payload`: current graph, stored payload, rerun kind and origin, double re-run refused.
- `a-re-run-of-a-paused-procedure-runs-once-and-a-failed-one-warns`: paused runs once, confirmation, failing re-run warning.
- `a-re-run-is-refused-for-a-deleted-procedure-a-missing-trigger-a-large-payload-and-a-lost-draft`: the four refusals by API and dialog.
- `the-re-run-confirmation-warns-in-the-words-of-the-run`: dialog text, Cancel, Confirm, drawer re-run opens the trace.
- `a-re-run-of-a-test-runs-the-draft-again-and-is-stored-as-a-test`: draft re-run, test confirmation.

## How to get to it (user POV)

- Run history: Open trace on a row, or the drawer; a notification or ticket links `?run=`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" trace
```

## Gotchas

- Failure cards, usual durations and comparisons need controlled timings: `parts/trace-seed.mjs` stores five runs with handcrafted logs.
- A run of an older version shows the "graph wasn't kept" banner, not the "used v1" info banner (the info banner is unreachable: both conditions are the same).
- The ledger (`/verify-auto/ledger`) shows what the effect steps received, to tell the full value from `[redacted]`.
