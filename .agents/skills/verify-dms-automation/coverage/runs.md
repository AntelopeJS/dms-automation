# Coverage: runs

Docs: `packages/dms-automation/docs/4.usage/4.runs.md` (Run history), `docs/3.configuration.md`, `docs/6.faq.md`, `skills/dms-automation/SKILL.md`. Journeys are in `journeys/runs.mjs` (+ `journeys/parts/runs-list.mjs`, `runs-page.mjs`).

| Source | Documented behaviour | Journey | Check |
| --- | --- | --- | --- |
| 4.runs.md:9 | The Run history is at `/modules/automation/runs` and lists every run of every procedure | the-run-list-serves-pages-of-25-newest-first | the other procedure's run is in the list |
| 4.runs.md:9 | Runs are grouped by day | the-list-is-grouped-by-day-with-the-documented-columns-and-tabs | older day groups with their counts, newest day first; Today's heading |
| 4.runs.md:9 | 25 to a page | the-run-list-serves-pages-of-25-newest-first | page 1 holds the 25 newest; page 2 holds the 2 oldest |
| 4.runs.md:9 | The page and footer say 25 per page and the page | the-list-is-grouped-by-day-with-the-documented-columns-and-tabs | the footer counts the items and the page size |
| 4.runs.md:9 | Newest first | the-run-list-serves-pages-of-25-newest-first | page 1 order; ascending order |
| 4.runs.md:9 | The period's figures sit above the list | the-run-figures-count-runs-success-rate-failed-and-p95-against-the-compared-window | the page shows the same figures |
| 4.runs.md:11 | The bar holds the period and the Live / Pause switch | the-row-menu-and-pause-keep-the-list-still | Pause button used; paused state |
| 4.runs.md:11 | Period offers 24H, 7D and 30D | the-period-and-comparison-are-shared-with-the-overview | the presets |
| 4.runs.md:11 | Both pages share the choice | the-period-and-comparison-are-shared-with-the-overview | the Overview opens on the period chosen in the Run history |
| 4.runs.md:11 | Same comparisons as the Overview (previous period, none) | the-run-figures-count-runs-success-rate-failed-and-p95-against-the-compared-window | comparison none leaves out the previous value |
| 4.runs.md:11 | Four figures Runs, Success rate, Failed, p95 (ms) | the-run-figures-count-runs-success-rate-failed-and-p95-against-the-compared-window | Runs; Success rate; Failed; p95 (ms) on the page |
| 4.runs.md:11 | Each figure has its change against the compared window | the-run-figures-count-runs-success-rate-failed-and-p95-against-the-compared-window | the four figures with their change (value, previous, delta) |
| 4.runs.md:13 | Live, new runs come into the list and the figures | live-brings-new-runs-into-the-list-and-the-figures | the figures count it; the list holds both runs (FAILS: issue draft dms-automation-runs-live-list-does-not-take-new-runs) |
| 4.runs.md:13 | The list holds still while a run is open beside it or while scrolled down | Not driven | the hold is a scroll position and a viewport behaviour; the drawer-open hold needs a second live event while the drawer is open, which the browser harness cannot time reliably |
| 4.runs.md:13 | Pause keeps the list and the figures still | the-row-menu-and-pause-keep-the-list-still | the list still holds 3 runs; the figures stay still |
| 4.runs.md:13 | The list keeps its rows through a search, a sort or another page | Not driven | needs more than one page of live rows plus a typed search in the browser; the paused count and Show are driven |
| 4.runs.md:13 | N new · Show counts the runs stored since | the-row-menu-and-pause-keep-the-list-still | N new · Show counts the run stored since; Show |
| 4.runs.md:17 | Tab Failed filters the list | the-tabs-and-filters-narrow-the-list-by-outcome-kind-and-procedure | Failed tab: filter status is failed |
| 4.runs.md:17 | Tab Succeeded | the-tabs-and-filters-narrow-the-list-by-outcome-kind-and-procedure | Succeeded tab: filter status is ok |
| 4.runs.md:17 | Tab Tests | the-tabs-and-filters-narrow-the-list-by-outcome-kind-and-procedure | Tests tab: filter kind is test |
| 4.runs.md:17 | The tabs show their counts | the-list-is-grouped-by-day-with-the-documented-columns-and-tabs | tab counts |
| 4.runs.md:17 | The Procedure filter narrows the list | the-tabs-and-filters-narrow-the-list-by-outcome-kind-and-procedure | Procedure filter is; is not; a blank procedure filter filters nothing |
| 4.runs.md:17 | Column filters narrow the list | the-tabs-and-filters-narrow-the-list-by-outcome-kind-and-procedure | Kind Re-run; Kind Run; Trigger type filter |
| 4.runs.md:18 | The search placeholder reads "Search procedures, errors, steps, paths or run ids…" | `the-list-is-grouped-by-day-with-the-documented-columns-and-tabs` | check `the search box` (Open search, then the textbox named with the exact placeholder) |
| 4.runs.md:18 | Search matches procedure names | search-finds-procedures-errors-steps-paths-and-run-ids | by procedure name (accents, CJK) |
| 4.runs.md:18 | Search matches errors | search-finds-procedures-errors-steps-paths-and-run-ids | by the error message (emoji and CJK) |
| 4.runs.md:18 | Search matches steps | search-finds-procedures-errors-steps-paths-and-run-ids | by the failed step's label |
| 4.runs.md:18 | Search matches paths | search-finds-procedures-errors-steps-paths-and-run-ids | by the trigger path |
| 4.runs.md:18 | Search matches run ids (or the start of one) | search-finds-procedures-errors-steps-paths-and-run-ids | by the whole run id; by the start of a run id; the middle finds nothing |
| 4.runs.md:19 | Columns Started, Outcome, Procedure, Trigger, Failed at, Duration, Kind in that order | the-list-is-grouped-by-day-with-the-documented-columns-and-tabs | columns in order; the rows, newest first |
| 4.runs.md:19 | Kind is Run, Re-run or Test | the-list-is-grouped-by-day-with-the-documented-columns-and-tabs | the rows (Test, Run, Re-run) |
| 4.runs.md:19 | The outcome cell shows the error, the failed step column its name | the-list-is-grouped-by-day-with-the-documented-columns-and-tabs | the rows (Failed disk full ☕ 日本, Charge card) |
| 4.runs.md:19 | Duration is drawn (ms, s) | the-list-is-grouped-by-day-with-the-documented-columns-and-tabs | the rows (12 ms, 1.5 s) |
| 4.runs.md:19 | Column picker adds run id, trigger type, error, end time, re-run origin, version | the-column-picker-adds-run-id-trigger-type-error-end-time-re-run-of-and-version | the columns in order with the default seven ticked; the headers; the extra cells |
| 4.runs.md:19 | Version column of an older run | runs-are-stored-with-the-columns-the-list-draws | the first run says it is of an older version (v1 · now v2) |
| 4.runs.md:20 | View runs opens the page on `?procedure=<procedureId>` | view-runs-opens-the-list-on-one-procedure-with-a-banner | the banner of one procedure |
| 4.runs.md:20 | A banner names the procedure with Show all runs | view-runs-opens-the-list-on-one-procedure-with-a-banner | title; Show all runs goes back to every run |
| 4.runs.md:20 | The figures above still count every procedure | view-runs-opens-the-list-on-one-procedure-with-a-banner | description |
| 4.runs.md:20 (TSDoc scopeBanner) | An empty `?procedure=` says nothing; a deleted procedure is still named | view-runs-opens-the-list-on-one-procedure-with-a-banner | an empty id, no banner (FAILS: issue draft dms-automation-runs-scope-banner-empty-procedure-500); a deleted procedure is still named |
| 4.runs.md:21 | Footer "Runs are kept 30 days" by default | the-retention-footer-says-how-long-runs-are-kept | default; retentionDays 30 |
| 4.runs.md:21 | Footer "Runs are kept forever" with 0 | the-retention-footer-says-how-long-runs-are-kept | retentionDays 0 |
| 4.runs.md:21 | Footer "Older runs are deleted after the retention period set for this project" otherwise | the-retention-footer-says-how-long-runs-are-kept | retentionDays 7; retentionDays 395 |
| 4.runs.md:23 | One click opens a run in a drawer, `?record=` keeps it | a-run-opens-in-a-drawer-with-summary-payload-and-logs | the URL keeps ?record= |
| 4.runs.md:23 | Drawer titled with the procedure and `Run 4 of 50` | a-run-opens-in-a-drawer-with-summary-payload-and-logs | title is the procedure and the place in the list |
| 4.runs.md:23 | Tabs Summary, Payload, Logs | a-run-opens-in-a-drawer-with-summary-payload-and-logs | tabs Summary, Payload and Logs with the log count 5 |
| 4.runs.md:23 | Summary holds the failure, the path taken and the steps | a-run-opens-in-a-drawer-with-summary-payload-and-logs | the failure; path taken and steps |
| 4.runs.md:23 | Payload holds what the trigger received | a-run-opens-in-a-drawer-with-summary-payload-and-logs | payload tab |
| 4.runs.md:23 | Logs holds the log | a-run-opens-in-a-drawer-with-summary-payload-and-logs | logs tab |
| 4.runs.md:23 | J and K step through the runs | a-run-opens-in-a-drawer-with-summary-payload-and-logs | J goes to the next run; K goes back; K again lands on the newest |
| 4.runs.md:23 | Buttons Re-run with this payload (icon), Open trace, Debug in builder at the bottom | a-run-opens-in-a-drawer-with-summary-payload-and-logs | Re-run with this payload visible; Open trace and Debug in builder; Open trace |
| 4.runs.md:23 | Drag the drawer's inner edge to widen it; it opens again at that width | Not driven | needs a pointer drag on the resize separator and a remembered width in local storage; the harness has only click, fill and press |
| 4.runs.md:23 (i18n) | A `?record=` for a run that is gone says This run is no longer kept | a-run-opens-in-a-drawer-with-summary-payload-and-logs | a ?record= for a run that is gone |
| 4.runs.md:25 | Row menu has Quick look (opens the same drawer), Re-run and Open trace | the-row-menu-and-pause-keep-the-list-still | the menu holds Quick look; Re-run and Open trace buttons on the row |
| 4.runs.md (routes) | Unknown run: 404 `run "<id>" not found` on the run, log, confirm and re-run | run-routes-refuse-an-unknown-run-and-odd-methods | unknown run ids |
| 4.runs.md (routes) | Unknown KPI metric answers 404; wrong methods are refused; nobody gets 401 | run-routes-refuse-an-unknown-run-and-odd-methods | unknown metric 404; methods the docs do not give a run are refused; a run is the owner's |
| 6.faq.md:44 | Test runs never count in the figures | the-run-figures-count-runs-success-rate-failed-and-p95-against-the-compared-window | the seeded failed test of 9999 ms moves no figure (Runs 20, Failed 5, p95 190) |
| SKILL.md:15 | Run history page and Run trace page exist at the named paths | a-run-opens-in-a-drawer-with-summary-payload-and-logs; trace journeys | Open trace |
| SKILL.md:16 | Run history period uses 24H/7D/30D with the comparison menu | the-period-and-comparison-are-shared-with-the-overview | the presets |
