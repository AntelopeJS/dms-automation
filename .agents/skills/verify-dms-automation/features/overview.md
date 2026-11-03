---
covers:
  - packages/dms-automation/src/stats/**
  - packages/dms-automation/src/routes/stats.ts
  - packages/dms-automation/src/pages/overview.ts
  - packages/dms-automation/src/pages/shared.ts
  - packages/dms-automation/src/db/models/stats.model.ts
  - packages/dms-automation/src/realtime.ts
  - packages/dms-automation/frontend-vue/app/components/AttentionList.vue
  - packages/dms-automation/frontend-vue/app/components/LiveTopics.vue
docs:
  - packages/dms-automation/docs/4.usage/1.overview.md
  - packages/dms-automation/docs/1.introduction.md
---

# Overview

The Overview page (`/modules/automation/overview`): the health banner and its four states, the period and comparison, the four figure cards, the Runs chart, Needs attention with Dismiss, Resume and Undo, the recent runs, the procedure counts, By trigger, live mode, and the recipes and the New procedure dialog.

## Sub-features

- `with-no-procedure-the-banner-offers-three-recipes`: With no procedure the banner reads Automate your first procedure and offers the recipes Forward a webhook, Send a scheduled digest and Run it on demand, in that order, over a primary banner.
- `a-recipe-opens-new-procedure-with-its-trigger-and-creates-a-disabled-draft`: Each recipe opens the New procedure dialog with its trigger picked; naming it and choosing Create and open the builder opens the builder on a disabled draft holding that trigger: a webhook on POST /webhooks/<name in lower case with dashes>, a schedule on 0 9 * * 1, or a manual trigger.
- `new-procedure-in-the-header-opens-the-dialog-with-a-webhook-picked`: New procedure in the header opens the same dialog at any time with A webhook is called picked and the line that it starts as a disabled draft; Run history in the header opens the run history.
- `the-idle-and-healthy-banners-say-so-and-count-runs-and-procedures`: Nothing ran in this window (no buttons) while procedures exist but no run falls in the period; Every procedure is healthy with the runs, failed runs and enabled procedures of the period, and Show failed runs only when runs failed in the period, for example those of a procedure paused since.
- `the-degraded-banner-counts-runs-and-offers-the-last-failure-and-the-failed-runs`: Degraded: N procedures degraded, the runs and failed runs of the period and how many procedures are enabled under it, with Open last failure and Show failed runs.
- `the-failing-banner-names-the-most-urgent-procedure-and-its-last-error`: Failing: N procedures failing; the line names the most urgent procedure (longest run of failures), since when it fails, and the error of its last failure with the step; Open last failure opens that procedure's last failed run, then Show failed runs for one failing procedure, Show failing procedures for several.
- `a-trigger-that-could-not-arm-gives-its-reason-and-no-run-to-open`: If the failing procedure's trigger could not be armed the line gives that reason instead of an error, and Open last failure is missing because there is no run to open.
- `the-banner-buttons-open-the-trace-the-failing-tab-and-the-failed-runs`: Open last failure opens the run trace of the last failed run, Show failing procedures opens the Procedures list on its Failing tab, Show failed runs opens the Run history on its Failed tab over the same period.
- `the-four-cards-compute-runs-success-rate-failed-and-p95-with-sparklines-and-changes`: The four cards Runs, Success rate, Failed and p95 (ms) show the figures of the period: the count of runs, ok over ok plus failed in percent with one decimal, the failed count, the 95th percentile (nearest rank) of the durations in ms; each has a sparkline per hour and its change against the compared window.
- `the-runs-chart-stacks-succeeded-and-failed-runs-per-hour-or-per-day`: The Runs chart stacks succeeded runs and failed runs, one bar per hour on 24H and one per day on 7D and 30D; with a comparison a dashed line draws the runs of the compared window bucket by bucket, the total sits above with its change and the compared total (vs 12), and the legend names Succeeded, Failed and Runs, compared period.
- `no-comparison-and-an-unkept-compared-window-show-no-change`: No comparison hides the changes under the figures and the dashed line; a change shows only when runs from the compared window are still kept, otherwise the line under the total reads Runs in the period.
- `test-runs-never-count-in-the-figures-the-banner-the-counts-or-the-recent-runs`: Test runs started from the builder never count in the run figures, the chart, the health banner, the procedure counts, Needs attention or the recent runs, even a failed one.
- `the-period-bar-holds-24h-7d-30d-says-when-it-starts-and-carries-over-to-the-run-history`: The bar holds the period 24H, 7D or 30D and says when the window starts; its comparison menu offers vs previous period (the default) and No comparison; the Run history uses the same period and comparison, so a choice made on one page carries over to the other.
- `vs-previous-year-is-offered-only-when-runs-are-kept-395-days-or-forever`: The comparison menu offers vs previous year too when the project keeps runs long enough to reach the same window a year earlier: a runs.retentionDays of 395 or more, or 0 to keep every run; the default of 30 days and 394 do not.
- `needs-attention-lists-failing-then-degraded-then-paused-longest-streak-first-at-most-five`: Needs attention lists the procedures that need someone, at most five, with Show all (N) when there are more: failing first, then degraded, then paused; within a state the longest run of failures first; each row says how many runs in a row failed at which step and with which error, why the trigger could not be armed, how many runs failed in the period and when the last one did, or when it was paused and by whom; actions Open trace, Dismiss, Resume and Open in builder by state.
- `dismiss-hides-a-degraded-procedure-until-its-next-failure-and-undo-brings-it-back`: Dismiss hides a degraded procedure until its next failure and offers Undo in the message that confirms it; with nothing to list the card reads Nothing needs attention.
- `resume-restarts-a-paused-procedure-and-undo-pauses-it-again-as-it-was`: Resume on a paused row enables the procedure and offers Undo in the message that confirms it; Undo puts the pause back as it was, with who paused it and when.
- `a-failing-procedure-is-listed-whatever-the-period-a-degraded-one-only-with-failures-inside-it`: A failing procedure is listed whatever the period; a degraded one is listed when runs failed within the period.
- `recent-runs-lists-the-last-eight-newest-first-each-linking-to-its-trace`: Recent runs lists the last eight runs, newest first, each linking to its trace, with a Run history link; a failed run says its error and step, a duration is shown in ms or s, a deleted procedure keeps the name its runs were stored with.
- `with-no-run-recent-runs-says-so`: With no run the Recent runs card says No runs yet.
- `the-procedure-counts-are-the-last-seven-days-add-up-and-link-to-their-tabs`: Procedures · last 7 days counts the procedures by state (Total, then Failing, Degraded, Healthy, Paused and Drafts), the counts add up to the total, and each count links to the matching tab of the Procedures list.
- `by-trigger-counts-the-procedures-each-trigger-type-starts-most-used-first`: By trigger shows how many procedures each trigger type starts, most used first; a procedure with two triggers of one type is one procedure of that type.
- `by-trigger-counts-a-procedure-once-per-trigger-type`: By trigger shows how many procedures each trigger type starts: a procedure that places two triggers of one type is one procedure of that type.
- `the-overview-follows-new-runs-live-until-paused-and-resume-catches-up`: The page follows new runs live: each stored run and each changed procedure makes it read the figures, the chart and the lists again, at most once every 10 seconds; Pause keeps the figures still, the switch counts what came in, and Resume catches up at once.
- `the-stats-routes-refuse-a-bad-period-and-an-unknown-figure`: The Overview's routes answer 400 with the reason for a date that is not one, a period that ends before it starts or spans more than a year, a 404 for a figure that is not one of the four cards, and no route accepts a write.

## How to get to it (user POV)

- Sign in as the platform owner, open Automation › Overview (`/modules/automation/overview`).
- The banner, the cards and the lists read `GET /api/automation/stats/{health,kpi/:metric,runs-per-day,attention,recent-runs,procedures,triggers}`; the period travels as `from`, `to`, `compareFrom`, `compareTo`, `preset`, `comparison`.
- The pages' choices live in the URL: `?automation-overview.period=last-24h&automation-overview.compare=none`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" overview
```

- Run histories are made with the fixture's `verify.fail` and `verify.flaky` actions through Run now; `journeys/parts/overview-kit.mjs` moves stored runs in time with the MongoDB driver (`backdate`, `seedRuns`) to fill the 24 hour window or older ones, since the windows are measured from the current time.
- Windows are asked with explicit `from`/`to` (see `windowQuery`) so hour buckets do not depend on when a journey runs.
- `withConfig` with `VERIFY_AUTO_RETENTION_DAYS` changes the comparison menu.

## Gotchas

- Test runs, recipes and the Needs attention rows only exist while the project holds no procedure (recipes) or the matching state: every journey starts from an empty database.
- Cards print upper case through CSS, so page text checks use `RUNS 20`, `SUCCESS RATE 85%`, `BY TRIGGER` and the like.
- Two journeys fail on purpose and have issue drafts: `vs-previous-year-is-offered-only-when-runs-are-kept-395-days-or-forever` and `by-trigger-counts-a-procedure-once-per-trigger-type`.
