# Design v2 port: grill-me session

This is the record of the design interview held before porting
`@antelopejs/dms-automation` to the v2 DMS (dms 0.6, interface-dms 0.4,
dms-frontend 0.5) and to the redesigned Automation screens of the design
mockup. It was run as a self-answered grill-me: every question was asked, and
the recommended answer was taken. It is here so a reviewer can check each
choice against the code instead of reverse-engineering it from the diff.

Inputs:

- the request: bump every AntelopeJS dependency, adapt to every breaking change
  (dms and dms-frontend first), apply the new design including the features it
  adds or removes, reuse the DMS blocks before writing custom components,
  describe every page on the backend with `meta()` and i18n on custom blocks so
  the roles screen reads well, and retest everything;
- the mockup: `modules/automation/*.html`, and its UX review (findings AU-01 to
  AU-19);
- `dms` 0.6.0 / `interface-dms` 0.4.0 (the v2 design, PR #119), its migration
  guide `docs/02.building/13.migration-0-3-to-0-4.md`;
- `dms-frontend` 0.5.0 (component prefix, no private components).

Each entry gives the question, the answer taken, and why.

---

## 1. Dependencies and compatibility

**Q1. Which ranges move?**
`@antelopejs/interface-dms` to `>=0.4.0 <1.0.0` (the repository's
`antelopejs-check-interface-ranges` gate refuses a cap below the next major for
a module that does not implement the interface), `@antelopejs/interface-data-api`
to `>=0.2.0 <1.0.0`, the frontend layer's `engines` to
`@antelopejs/dms-frontend >=0.5.0 <0.6.0`, `@antelopejs/core` to 1.13.5 (dev and
the agent setup script), and the playground to `@antelopejs/dms >=0.6.0`,
`@antelopejs/dms-frontend` 0.5.0 and `@antelopejs/mongodb ^1.4.2`.
*Why:* the DMS caps the interface below its next minor, so a module and the DMS
move to 0.4 together; dms 0.6 requires data-api 0.2 and dms-frontend 0.5, and
the migration guide asks MongoDB projects for mongodb 1.4.2. The other
`interface-*` ranges are already open to their latest releases.

**Q2. Is this a breaking release of the module?**
Yes: the PR title carries `!`. A project on dms 0.5 cannot load this module
any more, the HTTP API of the procedures changes (see Q19), and the run
documents gain fields. *Why:* changelogen only reads a breaking change from the
`!` in the header (the reason interface-dms 0.3.6 was unpublished).

**Q3. Does `@antelopejs/interface-dms-automation` change?**
No. Nothing in the redesign needs a new contract for other modules: node
labels, run kinds and test runs are internal to the module. *Why:* an interface
release forces every implementing module to move; it would buy nothing here.

## 2. Frontend layer (dms-frontend 0.5)

**Q4. How are the components named now?**
`componentPrefix: "DmsAutomation"` in `dms.frontend.ts`, components registered
by their file name (`Editor`, `HealthHero`…). The backend keeps sending
`dms-automation-<name>`, which normalizes to the same lookup key.
*Why:* 0.5 puts the prefix in front of every registered name and no longer
drops a leading `Dms`; registering `DmsAutomationX` by hand would now become
`DmsAutomationDmsAutomationX` once a prefix is declared, and without a prefix
the module would collide with nothing but would not follow the documented
convention.

**Q5. What about auto-imports?**
Add `dms.frontend.build.ts` registering `app/composables`, `app/utils` and
`app/types`. *Why:* since dms-frontend 0.4 nothing is auto-imported from a
module without that file; the Runs page crashed on `useAutomationRuns is not
defined` before it.

**Q6. Which DMS components can the layer still use?**
Only the public ones (`app/components`, not `app/build/components`):
`DmsCard`, `DmsStatusPill`, `DmsEmptyState`, `DmsKpiCard`, `DmsFlowCanvas`,
`DmsStatGroup`, `DmsSegmented`, `DmsKeyValueList`, `DmsMeter`,
`DmsSectionHeader`, `DmsBanner`, `DmsActivityItem`, `DmsCopyButton`… plus the
framework's `DmsLink` and `DmsClientOnly`. *Why:* build/ components are private
in 0.4 and may change without notice.

## 3. Pages: what the backend describes

**Q7. Who builds a page: the backend or one big Vue component?**
The backend. Each page is a tree of DMS blocks; a custom component only draws
what no block can (the health hero, the needs-attention list, the run trace,
the builder, the library catalogs). *Why:* the request, and it is what makes the
roles screen list each part of a page, with its own permission.

**Q8. How does a custom block read in the roles screen?**
Every `CustomComponent()` (and the modal forms of the header buttons) carries
`.meta({ name, description, icon })` with `$dms_automation.permissions.*` keys,
translated in both locales; `tests/pages.test.cjs` fails on one without it.
*Why:* the roles screen titles a component permission with `metadata.name`, run
through `processI18n`; without `meta()` a custom component shows its raw
component name. See Q10 for where module permissions show today.

**Q9. Which pages, in which navigation groups?**
The mockup's order — Overview, Run history (monitoring), then Procedures,
Builder, Library (building) — but no *Monitor* / *Build* label categories: a
category's id is part of every page and component permission id below it, so
adding them would silently drop the grants roles already hold. Run trace is a
new page hidden from the menu: it needs a run (`?run=<id>`,
`validation.requiredQueryParams`). The mockup's "Editor states", "Test run &
debug" and "UX review" entries are mockup scaffolding, not pages.
*Why:* the run becomes a first-class, linkable object, without breaking the
existing permission ids.

**Q10. Which permissions does the module expose?**
None beyond the pages and their components, and the API stays owner-only.
*Why:* checked while grilling, against the DMS docs ("Module navigation and
access") and `interface-dms/src/page/metadata.ts`: every page declared with
`module: "<id>"` is **module-scoped** — owner-only by design, its permission
ids never appear in the grantable roles tree, and permission checks deny them
to any non-owner whatever a role stores. Component actions (`.action()`) on
these pages would be dead weight, and route guards finer than
`@AuthOwnerOnly()` would grant nothing more. What did need fixing: the TableView
data routes of procedures and runs used `AuthRawUser` (any signed-in user could
read them); they are owner-only now, and the runs table goes through the DMS
routes and their own `list` check (Q45). The `meta()` of Q8 is kept so the
components read well wherever the DMS lists module permissions, today or once
it opens them to roles.

**Q11. One permission for Run now and Test run?**
Moot (Q10): both are owner-only, like the rest of the module.

## 4. Overview (AU-07, AU-08, AU-15)

**Q12. How is the overview composed?**
Header actions *Run history* (page link) and *New procedure* (modal form, Q20);
a `PeriodSelector` (`segmented`, 24 h / 7 d / 30 d, scope `automation`); the
custom **health hero** (one-line state, *Inspect last failure*, *Show failed
runs*); four `KpiCard`s on the period scope (success rate, runs, failed,
duration p95), with deltas; a `ChartCard` (runs per day, succeeded and failed);
the custom **needs attention** list; an `ActivityFeed` of recent runs; and a
`KeyValueList` + `TopListCard` for the procedures summary and the triggers.
*Why:* KPIs, charts, feeds and key/value lists exist as blocks; the hero and the
attention rows carry per-row actions and per-state copy no block has.

**Q13. Does the overview follow the period selector everywhere?**
KPIs, the chart and the hero do (`periodScope`); the feed and the attention
list are "now" views and ignore it. *Why:* `ActivityFeed` has no `periodScope`,
and "recent runs" means the latest ones whatever the window.

**Q14. Live refresh (AU-07: on and visible)?**
The hero shows "Live · updated N s ago" and refetches every 30 s, with a
refresh button; KPI and chart cards refetch when the period changes. No toggle.
*Why:* the review says auto-poll off by default hid problems; the hero is
where the state is read. Wiring every block to a timer would need a page-level
refresh event the DMS blocks do not expose.

**Q15. How are failures drawn on the 7-day chart (AU-15)?**
A `ChartCard` with a stacked column chart, succeeded and failed, in the theme's
success and error colors, bucketed by hour (24 h) or day (7 / 30 d), following
the period. *Why:* the block exists and follows the theme (no hard-coded hex);
a dedicated "failure lane" chart would be a custom chart for one panel.

**Q16. First-run state (no procedure yet)?**
The hero renders the "Automate your first workflow" empty state with three
recipes (Forward a webhook, Send a scheduled digest, Run on demand) that create
the procedure with its trigger and open the builder. *Why:* starts from a job,
not an empty graph; the blocks under it show their own empty states.

## 5. Health model (AU-06)

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
  *Failing* publishing the nav badge;
- columns: Procedure (`IdentityDisplay`, description as subtitle), Starts when
  (trigger summary, mono), Status (`StatusPillDisplay`, last error under it),
  Last run (`RelativeDateDisplay`), Last 12 runs (module display
  `automation:last-runs`), Success 7 d (percentage), Avg (`DurationDisplay`);
- a double-click on a row opens the builder (the DMS grid opens rows on
  double-click); row actions Run now (with the last real payload, after a
  confirmation), Pause / Resume, View runs, Delete;
- header actions Import JSON and New procedure.

*Why:* every column has a built-in display except the run strip, which the DMS
docs themselves use as the example of a module display.

**Q20. "New procedure" (AU-11)?**
A header button opening a modal `Form` (`kind: "action"`): name, what starts it
(webhook / schedule / manual), description; it posts to
`POST /api/automation/procedures/new`, which creates a disabled draft with the
trigger node placed, and `redirectOnSuccess` opens the builder on it.
*Why:* the DMS form, modal target and redirect cover the dialog; no custom
modal needed.

**Q21. Delete confirmation?**
`confirm: { from }` on the delete row action: the server words it — for an
enabled procedure it names what stops (the webhook path, the schedule), counts
this week's runs, asks to type the name (`confirmText`), and suggests pausing.
Run history is kept until retention removes it. *Why:* the confirmation is the
server-worded `ConfirmDialog` of 0.4.

**Q22. Import / export JSON?**
Yes. *Import JSON* (header button, modal form with the JSON) creates a disabled
copy; *Export JSON* is in the builder's menu. The format is
`{ name, description, graph }`, validated like a save. *Why:* in the mockup, and
cheap on top of the existing graph schema.

## 7. Run history and run trace (AU-01, AU-02, AU-08, AU-17)

**Q23. Keep the custom `automation:timeline` display?**
No. The run list uses the built-in `grouped` display (by day, with counts) and
the grid's own columns; the custom display and its plugin are removed. *Why:*
the DMS docs name "a timeline of runs" as what `grouped` replaces.

**Q24. Columns of the run list?**
Started (`RelativeDateDisplay`), Procedure (identity, run id as subtitle),
Trigger (`automation:trigger` display: "POST /webhooks/stripe", "Every day at
02:00"), Outcome (`StatusPillDisplay`, the error under it), Failed at
(`automation:step`), Duration (`DurationDisplay`), Kind (run / re-run / test).
The procedure's name is stored on the run and renamed with the procedure (and
back-filled at boot for older runs): the relation join cannot read the
computed procedures controller, and a stored name sorts and searches.
*Why:* the mockup row, with built-in displays where they exist.

**Q25. Quick peek?**
A custom row action with `isDefault` and `deepLink` opening a drawer
(`RunPeek`): summary, failing step, error, path taken, payload, logs, with
*Re-run with this payload*, *Open trace* and *Debug in builder*; J/K step
through rows. *Why:* the DMS row drawer contract is exactly this.

**Q26. Period, KPIs and tabs on Run history?**
A `PeriodSelector` (24 h / 7 d / 30 d) drives four `KpiCard`s; the table has
tabs All / Failed / Succeeded / Tests and a quick filter on the procedure. The table itself is not period-filtered (TableView has no
`periodScope`); its default sort is newest first. *Why:* the review wanted
one window for KPIs and list; the table can't follow a period scope without a
DMS change, so the KPIs say their window and the list says "kept 30 days".

**Q27. Re-run (AU-01)?**
`POST /api/automation/runs/:id/rerun` executes the procedure's saved graph
from the run's trigger node with the run's stored payload, for every trigger
type, and stores a run with `kind: "rerun"` and `rerunOf`. The old Replay sent
`{}`. *Why:* the finding; a re-run must use the data that failed.

**Q28. What does a run record now hold?**
New fields: `kind` (`run` | `rerun` | `test`), `rerunOf`, `failedNodeId` and
`failedStep`, `procedureName`, `instanceId`, `procedureVersion`, `durationMs`,
`triggerType` and `triggerSummary`, and per-step exec entries ("executed", or
the error) with duration, inputs and output, bounded by the existing log
budget. Old runs without them still render (fields optional). A payload too
large to keep cannot be re-run (409, said in the trace). *Why:* the trace
waterfall, the failing step's name, the run list's columns and "this run used
an older version" need them.

**Q29. Run trace page?**
A hidden page `trace?run=<id>` with a custom `RunTrace` component: header
(status, step x of n, duration vs usual, trigger, version, instance), tabs
Steps (waterfall with named steps, skipped ones greyed) / Payload / Logs, the
error box naming the step with the last success, the path-taken graph and the
comparison with the last success. Actions *Re-run with this payload* and
*Debug in builder*. *Why:* AU-02.

**Q30. Procedure versions?**
A `version` counter increments on every save and is stamped on runs; the trace
says when a run used an older version. Read-only browsing of old versions and
"Compare versions" are not built (no graph history is stored). *Why:* the
counter is cheap and answers "was this the current graph?"; keeping every graph
is a storage decision for its own PR.

**Q31. Retention ("Runs are kept 30 days")?**
New config `runs.retentionDays`, default 30, `0` keeps everything; the leader
purges older runs hourly. *Why:* the mockup states it, and the runs collection
grew without bound.

## 8. Builder (AU-03, AU-04, AU-05, AU-09, AU-10, AU-16, AU-17, AU-18, AU-19)

**Q32. Rewrite the editor?**
No: the graph logic of `Editor.vue` (history, groups, templates, sentinels,
port renames) stays; its chrome is rebuilt: a 52 px top bar (name, state pill,
Enabled switch, save state, Discard, Test run ⌘↵, Save ⌘S, ⌘P switcher), the
palette left, a docked inspector right (tabs Settings / Last run / Docs), and a
bottom dock (Problems / Recent runs / Test payload). *Why:* the logic is tested
and dense; the findings are about chrome and feedback.

**Q33. Collapse the module sidebar in the builder (AU-19)?**
No. The DMS layout has no per-page sidebar option, and a module must not reach
into the layout's internals. The page uses `fillHeight` and drops its native
header (`hideHeader`); the bottom dock stays collapsed until it has something
to say, and the minimap is left out (it covered the nodes of a small canvas).
*Why:* most of the space is won by removing the header and the toolbar card.

**Q34. Unsaved changes (AU-04)?**
Save state in the top bar, Save/Discard instead of Apply/Cancel, and a
"Save changes to …?" dialog (Save and switch / Keep editing / Discard) when
switching procedure; leaving the page goes through the DMS leave guard.
*Why:* the finding.

**Q35. Validation errors (AU-03)?**
The validator returns issues `{ message, nodeId? }`; the server answers them on
a refused save; the builder shows a problems banner, a Problems dock with
*Select node*, and marks the nodes. A graph with problems can be saved as a
disabled draft; enabling it is refused while it has errors. *Why:* the finding;
the runtime already never fires a disabled procedure and validates before
running.

**Q36. Test run (AU-05)?**
`POST /api/automation/procedures/:id/test { graph, triggerNodeId?, payload }`
runs the draft without saving it and returns the run; the canvas overlays each
node's status, the dock lists the steps, the inspector's "Last run" tab shows
the node's input and output. The payload defaults to the last real call's
payload. When the draft is dirty, *Run now* asks which version to run.
*Why:* the finding; the executor already runs any graph from any trigger.

**Q37. Node labels and summaries (AU-10)?**
Nodes get an optional `label` (renamed in the inspector; the schema already
passes extra fields through) and a one-line summary of their key setting
(HTTP method + host + path, humanized cron, webhook method + path, log message);
categories get a color role (trigger cyan/info, flow amber/warning, data
green/success, action primary). *Why:* the finding; traces and problems name
steps by label.

**Q38. Wired fields (AU-09)?**
Show "From <source label> · <port>" instead of the node id. *Why:* the finding.

**Q39. Secrets in headers (AU-12)?**
Not in this PR. The mockup puts secrets in workspace settings, which belong to
the DMS core; a module-local secret store would have to be migrated later. The
HTTP request inspector says credentials should not be typed into the graph.
*Why:* a secret store is a security feature that needs its own design, in the
DMS, not a side effect of a redesign.

**Q40. The builder's Runs drawer (AU-17)?**
Removed. The bottom dock lists this procedure's last runs with the run-history
row design and a trace link; "All runs" opens Run history filtered on the
procedure. *Why:* one run list design.

**Q41. Disabled banner (AU-16)?**
Names the trigger and, for a schedule, the next occurrence it would have had;
one-click *Enable*. *Why:* the finding.

**Q42. Icons typed as strings (AU-14)?**
An icon picker grid (Phosphor icons common to automation) with a free-text
fallback, in Save as template and the template form; Save as template also
lists the ports inferred from the wires crossing the group. *Why:* the finding.

**Q43. Toasts (AU-18)?**
Every toast goes through the locale files and names the object. *Why:* French
users got English toasts.

## 9. Library (AU-13)

**Q44. How is the library composed?**
A DMS `Tab` block (Triggers, Actions, Data nodes, Templates, with counts from
`badgesUrl`); each tab is a custom catalog in the DMS master/detail look: list
grouped by source module, detail with *Used by* (procedure, state, node, full
webhook URL with copy), the impact of disabling, node settings as a read-only
form, inputs/outputs as typed tables, the cluster behaviour in words, and the
global config JSON under *Advanced*. Templates: name, icon, description, ports,
used in, delete (forks each usage into a local group). *Why:* the finding; the
tab block exists, and a catalog is a master/detail no block draws.
Grilling also found that the Enabled switch was stored but never read by the
runtime: a disabled trigger type now stops being armed, a disabled action type
fails its step, and the switch takes effect at once on every instance.

## 10. Security and bugs found while grilling

**Q45. What else gets fixed on the way?**
Found while grilling, or while testing every screen in the playground:
- TableView data routes of procedures and runs accepted any signed-in user
  (`AuthRawUser`): owner-only now, like the rest of the module (Q10).
- Replay sent an empty body (Q27).
- The builder ignored `?selected=` from the procedures list (it always opened
  the first procedure) and listed only 20 procedures.
- Saving a template from the builder reset its icon to the default.
- Wired fields never rendered: the inspector named a component
  (`DmsAutomationEditorWiredField`) that was never registered.
- A trigger edge with no branch (hand-written or imported graphs) was dropped
  after any action: it now leaves by the main port, as the builder draws it.
- The library's Enabled switch had no effect (Q44).
- The HTTP request action sent an object body without a JSON content type, and
  failed GET/HEAD steps with fetch's cryptic error when a body was wired: the
  body is now dropped for those methods, with a warning in the run log.
- Selecting a node counted as an unsaved change (a sub-pixel position change),
  and ⌘S / ⌘↵ reopened a focused select.
- Built-in trigger and action names were English literals: they are i18n keys
  now, so the palette, the library and the traces read in French.

**Q46. Tests?**
`pnpm test:unit` (in CI): the health states and figures, test runs excluded,
KPI windows and deltas, graph problems mapped to nodes, a failed run naming its
step and the trace read from its log, cron next occurrences and retention, the
page trees (every custom component named with a translated `meta`), and the
procedures table. `test:runs-display` and `test:type-display` were rewritten
for the grouped display, the cell displays and the describe helpers. The
frontend passes `ajs dms verify-source`, and every screen was driven in the
playground with Playwright (overview, run drawer and trace, procedures with the
new-procedure dialog and delete confirmation, builder test run / save / Run now
/ switcher with unsaved changes, library), in English and French, light and
dark.
