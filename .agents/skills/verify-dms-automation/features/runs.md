---
covers:
  - packages/dms-automation/src/pages/runs.ts
  - packages/dms-automation/src/data/runs-table.ts
  - packages/dms-automation/src/routes/runs.ts
  - packages/dms-automation/src/routes/stats.ts
  - packages/dms-automation/src/stats/kpi.ts
  - packages/dms-automation/src/stats/health.ts
  - packages/dms-automation/src/runtime/retention.ts
  - packages/dms-automation/frontend-vue/app/components/RunPeek.vue
  - packages/dms-automation/frontend-vue/app/composables/useAutomationRuns.ts
  - packages/dms-automation/frontend-vue/app/utils/redactedHeaders.ts
docs:
  - packages/dms-automation/docs/4.usage/4.runs.md
  - packages/dms-automation/docs/3.configuration.md
  - packages/dms-automation/docs/6.faq.md
---

# Runs

The Run history at `/modules/automation/runs`: every run of every procedure grouped by day, 25 to a page, with the period's figures, tabs, search, filters, a drawer per run, a row menu, Live and Pause, and the retention footer.

## Sub-features

- `the-run-list-serves-pages-of-25-newest-first`: 27 runs of two procedures, page 1 holds the 25 newest in order, page 2 the 2 oldest, the total and the count route, ascending order.
- `the-tabs-and-filters-narrow-the-list-by-outcome-kind-and-procedure`: Failed, Succeeded and Tests tabs, the Kind, Procedure and Trigger type filters, the row fields (kind, status, error text, failed step).
- `search-finds-procedures-errors-steps-paths-and-run-ids`: search by procedure name (accents, CJK), error text, failed step label, trigger path, run id or its start, and nothing for the middle of an id.
- `view-runs-opens-the-list-on-one-procedure-with-a-banner`: `?procedure=` banner text, Show all runs, deleted and unknown procedures, the empty-id case (fails: issue draft).
- `runs-are-stored-with-the-columns-the-list-draws`: trigger words, version `v1 · now v2`, end time, re-run origin, failed step.
- `the-column-picker-adds-run-id-trigger-type-error-end-time-re-run-of-and-version`: the column picker adds the run id, the trigger type, the error, the end time, the run it re-ran and the procedure version, each with its documented content.
- `the-list-is-grouped-by-day-with-the-documented-columns-and-tabs`: day groups and counts, column order and cells, tab counts, items, page size, page.
- `a-run-opens-in-a-drawer-with-summary-payload-and-logs`: `?record=`, `Run n of N`, three tabs, failure and path, J and K, buttons, a record that is gone.
- `the-row-menu-and-pause-keep-the-list-still`: Quick look in the menu, Re-run and Open trace on the row, Pause, `N new · Show`.
- `live-brings-new-runs-into-the-list-and-the-figures`: a run stored while Live reaches the list (fails: issue draft).
- `the-period-and-comparison-are-shared-with-the-overview`: 24H, 7D, 30D and the choice carried to the Overview.
- `the-run-figures-count-runs-success-rate-failed-and-p95-against-the-compared-window`: the four figures with the change, tests excluded, the page's figures.
- `the-retention-footer-says-how-long-runs-are-kept`: the three footer sentences by `runs.retentionDays`.
- `run-routes-refuse-an-unknown-run-and-odd-methods`: 404 texts, unknown KPI metric, wrong methods, anonymous.

## How to get to it (user POV)

- Overview, Procedures (View runs) or the sidebar: Automation › Run history.

## Driving it with dms-control

```bash
dms-control journey "$RUN" runs
```

## Gotchas

- Runs the product cannot be made to write by waiting (old, backdated, handcrafted logs) are inserted in the run's MongoDB with `parts/runs-common.mjs` (`insertRuns`, `runDocument`, `logOf`).
- The list is the DMS table API `/api/automation/tables/runs/list`: `limit`, `offset`, `sortKey`, `sortDirection`, `search`, `filter_<field>=<mode>:<value>` with the modes `is` and `is_not`.
- Relative dates in the Started column ("3 min. ago") move: the page journeys normalise them.
- Webhook calls answer 500 in this playground (the cached `@antelopejs/api` has no `ReadBody`), so payloads with headers come from Run now and the fixture's event trigger.
