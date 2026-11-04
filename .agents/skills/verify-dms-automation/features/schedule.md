---
covers:
  - packages/dms-automation/src/runtime/builtins/triggers/cron.ts
  - packages/dms-automation/src/runtime/schedule.ts
  - packages/dms-automation/src/runtime/wording.ts
  - packages/dms-automation/src/runtime/describe.ts
docs:
  - packages/dms-automation/docs/4.usage/2.procedures.md
  - packages/dms-automation/docs/4.usage/1.overview.md
  - packages/dms-automation/docs/6.faq.md
---

# Schedule

The Schedule (cron) trigger fires a procedure on a cron expression in the server's time zone. The pages word the expression (`Every hour at :00`, `Weekdays at 08:00 (UTC)`), show the next run, and show an unarmable schedule as Failing with its reason.

## Sub-features

- `a-schedule-must-be-a-valid-cron-expression`: five fields, or six with seconds first, with lists, ranges, steps and names; anything else is refused with `invalid cron expression: "<value>"`; an invalid schedule cannot be enabled but a draft holds it.
- `a-schedule-shows-its-next-run`: the next occurrence reported for a saved schedule, `either day field` semantics, the time zone, the Builder's `Next run:` and paused banner.
- `the-starts-when-column-words-a-schedule-and-a-webhook`: 31 expressions in words in the API and on the Procedures page, with the trigger type under the words.
- `an-invalid-schedule-in-an-enabled-procedure-is-failing-with-the-reason`: Failing with `Trigger not armed:` and the reason on the Procedures page and the Overview, no run to open.
- `the-schedule-recipe-places-a-monday-09-00-schedule`: the Send a scheduled digest recipe places `0 9 * * 1`.
- `an-enabled-schedule-fires-runs-and-stops-when-paused-or-edited`: a real schedule starts runs with `{firedAt}`; pausing, editing and deleting stop it.

## How to get to it (user POV)

- A Schedule (cron) trigger in the Builder, the Procedures page (Starts when, Status), the Overview.

## Driving it with dms-control

```bash
dms-control journey "$RUN" schedule
```

## Gotchas

- The words and the next run follow the backend's time zone: journeys that read clock times restart the backend with `TZ=UTC` (`withConfig`) and compute the next occurrence with `parts/cron-reference.mjs`, an independent reading of the cron rules.
- An enabled invalid schedule cannot be saved through the API, so the journeys store the procedure in the database (`storeEnabled`) and restart the backend.
- The Procedures list holds 10 rows a page: the wording journey pages through it.
