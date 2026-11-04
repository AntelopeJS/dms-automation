---
title: "Design v2 port, the grill-me session (part 1)"
description: Decision log of the automation module's port to the v2 DMS, sections 1 to 6. Dependencies, frontend layer, pages, overview, health model and the procedures list.
mode: explanation
---

This is the record of the design interview held before porting
`@antelopejs/dms-automation` to the v2 DMS (`dms` 0.6, `interface-dms` 0.4,
`dms-frontend` 0.5) and to the redesigned Automation screens of the design
mockup. It was run as a self-answered grill-me. Every question was asked, and
the recommended answer was taken. It is here so a reviewer can check each
choice against the code instead of reverse-engineering it from the diff.

Inputs:

- the request: bump every AntelopeJS dependency, adapt to every breaking change
  (`dms` and `dms-frontend` first), apply the new design including the features it
  adds or removes, reuse the DMS blocks before writing custom components,
  describe every page on the backend with `meta()` and i18n on custom blocks so
  the roles screen reads well, and retest everything.
- the mockup: `modules/automation/*.html`, and its UX review (findings AU-01 to
  AU-19).
- `dms` 0.6.0 / `interface-dms` 0.4.0 (the v2 design, PR `dms#119`), its migration
  guide `docs/02.building/13.migration-0-3-to-0-4.md`.
- `dms-frontend` 0.5.0 (component prefix, no private components).

Each entry gives the question, the answer taken, and why.

---

## 1. Dependencies and compatibility

**Q1. Which ranges move?**
`interface-dms` to the 0.4 line, open up to the next major (the repository's
`antelopejs-check-interface-ranges` gate refuses a cap below the next major for
a module that does not implement the interface), `interface-data-api` to the
0.2 line, open up to the next major, the frontend layer's `engines` to the
`dms-frontend` 0.5 line, `core` to 1.13.5 (dev and the agent setup script), and
the playground to `dms` from 0.6.0, `dms-frontend` 0.5.0 and the `mongodb` 1.4
line from 1.4.2.
*Why:* the DMS caps the interface below its next minor, so a module and the DMS
move to 0.4 together. DMS 0.6 requires data-api 0.2 and `dms-frontend` 0.5, and
the migration guide asks MongoDB projects for `mongodb` 1.4.2. The other
`interface-*` ranges are already open to their latest releases.

**Q2. Is this a breaking release of the module?**
Yes. The PR title carries `!`. A project on DMS 0.5 cannot load this module
any more, the HTTP API of the procedures changes (see Q19), and the run
documents gain fields. *Why:* changelogen only reads a breaking change from the
`!` in the header (the reason `interface-dms` 0.3.6 was unpublished).

**Q3. Does `@antelopejs/interface-dms-automation` change?**
No. Nothing in the redesign needs a new contract for other modules. Node
labels, run kinds and test runs are internal to the module. *Why:* an interface
release forces every implementing module to move. It would buy nothing here.

## 2. Frontend layer (`dms-frontend` 0.5)

**Q4. How are the components named now?**
`componentPrefix: "DmsAutomation"` in `dms.frontend.ts`, components registered
by their file name (`Editor`, `HealthHero`…). The backend keeps sending
`dms-automation-<name>`, which normalizes to the same lookup key.
*Why:* 0.5 puts the prefix in front of every registered name and no longer
drops a leading `Dms`. Registering `DmsAutomationX` by hand would now become
`DmsAutomationDmsAutomationX` once a prefix is declared, and without a prefix
the module would collide with nothing but would not follow the documented
convention.

**Q5. What about auto-imports?**
Add `dms.frontend.build.ts` registering `app/composables`, `app/utils` and
`app/types`. *Why:* since `dms-frontend` 0.4 nothing is auto-imported from a
module without that file. The Runs page crashed on `useAutomationRuns is not
defined` before it.

**Q6. Which DMS components can the layer still use?**
Only the public ones (`app/components`, not `app/build/components`):
`DmsCard`, `DmsStatusPill`, `DmsEmptyState`, `DmsKpiCard`, `DmsFlowCanvas`,
`DmsStatGroup`, `DmsSegmented`, `DmsKeyValueList`, `DmsMeter`,
`DmsSectionHeader`, `DmsBanner`, `DmsActivityItem`, `DmsCopyButton`… plus the
framework's `DmsLink` and `DmsClientOnly`. *Why:* build/ components are private
in 0.4 and may change without notice.

## 3. Pages: what the backend describes

**Q7. Who builds a page, the backend or one big Vue component?**
The backend. Each page is a tree of DMS blocks. A custom component only draws
what no block can (the health hero, the needs-attention list, the run trace,
the builder, the library catalogs). *Why:* the request, and it is what makes the
roles screen list each part of a page, with its own permission.

**Q8. How does a custom block read in the roles screen?**
Every `CustomComponent()` (and the modal forms of the header buttons) carries
`.meta({ name, description, icon })` with `$dms_automation.permissions.*` keys,
translated in both locales. `tests/pages.test.cjs` fails on one without it.
*Why:* the roles screen titles a component permission with `metadata.name`, run
through `processI18n`. Without `meta()` a custom component shows its raw
component name. See Q10 for where module permissions show today.

**Q9. Which pages, in which navigation groups?**
The mockup's order, Overview and Run history (monitoring), then Procedures,
Builder and Library (building), but no *Monitor* / *Build* label categories. A
category's id is part of every page and component permission id below it, so
adding them would silently drop the grants roles already hold. Run trace is a
new page hidden from the menu. It needs a run (`?run=<id>`,
`validation.requiredQueryParams`). The mockup's "Editor states", "Test run &
debug" and "UX review" entries are mockup scaffolding, not pages.
*Why:* the run becomes a first-class, linkable object, without breaking the
existing permission ids.

**Q10. Which permissions does the module expose?**
None beyond the pages and their components, and the API stays owner-only.
*Why:* checked while grilling, against the DMS docs ("Module navigation and
access") and `interface-dms/src/page/metadata.ts`. Every page declared with
`module: "<id>"` is **module-scoped**. Such a page is owner-only by design, its permission
ids never appear in the grantable roles tree, and permission checks deny them
to any non-owner whatever a role stores. Component actions (`.action()`) on
these pages would be dead weight, and route guards finer than
`@AuthOwnerOnly()` would grant nothing more. One thing did need fixing. The TableView
data routes of procedures and runs used `AuthRawUser` (any signed-in user could
read them). They are owner-only now, and the runs table goes through the DMS
routes and their own `list` check (Q45). The `meta()` of Q8 is kept so the
components read well wherever the DMS lists module permissions, today or once
it opens them to roles.

**Q11. One permission for Run now and Test run?**
Moot (Q10). Both are owner-only, like the rest of the module.

## 4. Overview

Review findings AU-07, AU-08 and AU-15.

**Q12. How is the overview composed?**
The overview is composed of:

- header actions *Run history* (page link) and *New procedure* (modal form, Q20)
- a `PeriodSelector` (`segmented`, 24 h / 7 d / 30 d, scope `automation`)
- the custom **health hero** (one-line state, *Inspect last failure*, *Show
  failed runs*)
- four `KpiCard`s on the period scope (success rate, runs, failed, duration
  p95), with deltas
- a `ChartCard` (runs per day, succeeded and failed)
- the custom **needs attention** list
- an `ActivityFeed` of recent runs
- a `KeyValueList` + `TopListCard` for the procedures summary and the triggers.

*Why:* KPIs, charts, feeds and key/value lists exist as blocks. The hero and the
attention rows carry per-row actions and per-state copy no block has.

**Q13. Does the overview follow the period selector everywhere?**
KPIs, the chart and the hero do (`periodScope`). The feed and the attention
list are "now" views and ignore it. *Why:* `ActivityFeed` has no `periodScope`,
and "recent runs" means the latest ones whatever the window.

**Q14. Live refresh (AU-07, on and visible)?**
The hero shows "Live · updated N s ago" and refetches every 30 s, with a
refresh button. KPI and chart cards refetch when the period changes. No toggle.
*Why:* the review says auto-poll off by default hid problems. The hero is
where the state is read. Wiring every block to a timer would need a page-level
refresh event the DMS blocks do not expose.

**Q15. How are failures drawn on the 7-day chart (AU-15)?**
A `ChartCard` with a stacked column chart, succeeded and failed, in the theme's
success and error colors, bucketed by hour (24 h) or day (7 / 30 d), following
the period. *Why:* the block exists and follows the theme (no hard-coded hex).
A dedicated "failure lane" chart would be a custom chart for one panel.

**Q16. First-run state (no procedure yet)?**
The hero renders the "Automate your first workflow" empty state with three
recipes (Forward a webhook, Send a scheduled digest, Run on demand) that create
the procedure with its trigger and open the builder. *Why:* it starts from a job,
not an empty graph. The blocks under it show their own empty states.

## 5. Health model

Review finding AU-06.

**Q17. What are the procedure states?**
Five, computed over the selected window (7 days on the list):

| State | Rule |
| --- | --- |
| Draft | no trigger yet, or disabled and never enabled nor run (a new or imported procedure) |
| Paused | disabled after being enabled, or after it ran |
| Failing | enabled, last run failed |
| Degraded | enabled, last run ok, failures in the window |
| Healthy | enabled, no failure in the window |

*Why:* "failing" used to mean "one failure in 7 days", which put a job that
recovered next to one that has been broken for an hour.

**Q18. Do test runs count?**
No. Test runs are stored (they have a trace) with `kind: "test"`, and every
health figure, KPI and state reads production runs only (`kind` absent or
`"run"`/`"rerun"`). *Why:* testing a broken draft must not page anyone.

## 6. Procedures list

**Q19. Native TableView or custom list?**
Native `TableView` over the computed summary controller, with:

- tabs All / Failing / Degraded / Healthy / Paused / Draft (one-column
  filters, as 0.4 requires, with a `countBatch` route for their counters),
  *Failing* publishing the nav badge.
- columns: Procedure (`IdentityDisplay`, description as subtitle), Starts when
  (trigger summary, mono), Status (`StatusPillDisplay`, last error under it),
  Last run (`RelativeDateDisplay`), Last 12 runs (module display
  `automation:last-runs`), Success 7 d (percentage), Avg (`DurationDisplay`).
- a double-click on a row opens the builder (the DMS grid opens rows on
  double-click). Row actions Run now (with the last real payload, after a
  confirmation), Pause / Resume, View runs, Delete.
- header actions Import JSON and New procedure.

*Why:* every column has a built-in display except the run strip, which the DMS
docs themselves use as the example of a module display.

**Q20. "New procedure" (AU-11)?**
A header button opening a modal `Form` (`kind: "action"`): name, what starts it
(webhook / schedule / manual), description. It posts to
`POST /api/automation/procedures/new`, which creates a disabled draft with the
trigger node placed, and `redirectOnSuccess` opens the builder on it.
*Why:* the DMS form, modal target and redirect cover the dialog. No custom
modal is needed.

**Q21. Delete confirmation?**
`confirm: { from }` on the delete row action. The server words it. For an
enabled procedure it names what stops (the webhook path, the schedule), counts
this week's runs, asks to type the name (`confirmText`), and suggests pausing.
Run history is kept until retention removes it. *Why:* the confirmation is the
server-worded `ConfirmDialog` of 0.4.

**Q22. Import / export JSON?**
Yes. *Import JSON* (header button, modal form with the JSON) creates a disabled
copy. *Export JSON* is in the builder's menu. The format is
`{ name, description, graph }`, validated like a save. *Why:* in the mockup, and
cheap on top of the existing graph schema.

Sections 7 to 11 continue in [part 2](./design-v2-grill-me-2.md).
