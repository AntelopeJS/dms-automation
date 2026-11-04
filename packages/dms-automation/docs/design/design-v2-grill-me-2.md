---
title: "Design v2 port, the grill-me session (part 2)"
description: Decision log of the automation module's port to the v2 DMS, sections 7 to 11. Run history and trace, builder, library, fixes found on the way and the QA revisions.
mode: explanation
---

This is the second half of the decision log. The inputs and sections 1 to 6 are in [part 1](./design-v2-grill-me.md).

## 7. Run history and run trace

Review findings AU-01, AU-02, AU-08 and AU-17.

**Q23. Keep the custom `automation:timeline` display?**
No. The run list uses the built-in `grouped` display (by day, with counts) and
the grid's own columns. The custom display and its plugin are removed. *Why:*
the DMS docs name "a timeline of runs" as what `grouped` replaces.

**Q24. Columns of the run list?**
Started (`RelativeDateDisplay`), Procedure (identity, run id as subtitle),
Trigger (`automation:trigger` display, such as "POST /webhooks/stripe" or "Every day
at 02:00"), Outcome (`StatusPillDisplay`, the error under it), Failed at
(`automation:step`), Duration (`DurationDisplay`), Kind (run / re-run / test).
The procedure's name is stored on the run and renamed with the procedure,
because the relation join cannot read the
computed procedures controller, and a stored name sorts and searches.
*Why:* the mockup row, with built-in displays where they exist.

**Q25. Quick peek?**
A custom row action with `isDefault` and `deepLink` opening a drawer
(`RunPeek`): summary, failing step, error, path taken, payload, logs, with
*Re-run with this payload*, *Open trace* and *Debug in builder*. J/K step
through rows. *Why:* the DMS row drawer contract is exactly this.

**Q26. Period, KPIs and tabs on Run history?**
A `PeriodSelector` (24 h / 7 d / 30 d) drives four `KpiCard`s. The table has
tabs All / Failed / Succeeded / Tests and a quick filter on the procedure. The table itself is not period-filtered (TableView has no
`periodScope`). Its default sort is newest first. *Why:* the review wanted
one window for KPIs and list. The table can't follow a period scope without a
DMS change, so the KPIs say their window and the list says "kept 30 days".

**Q27. Re-run (AU-01)?**
`POST /api/automation/runs/:id/rerun` executes the procedure's saved graph
from the run's trigger node with the run's stored payload, for every trigger
type, and stores a run with `kind: "rerun"` and `rerunOf`. The old Replay sent
`{}`. *Why:* the finding. A re-run must use the data that failed.

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
A `version` counter increments on every save and is stamped on runs. The trace
says when a run used an older version. Read-only browsing of old versions and
"Compare versions" are not built (no graph history is stored). *Why:* the
counter is cheap and answers "was this the current graph?" Keeping every graph
is a storage decision for its own PR.

**Q31. Retention ("Runs are kept 30 days")?**
New config `runs.retentionDays`, default 30, `0` keeps everything. The leader
purges older runs hourly. *Why:* the mockup states it, and the runs collection
grew without bound.

## 8. Builder

Review findings AU-03, AU-04, AU-05, AU-09, AU-10, AU-16, AU-17, AU-18 and AU-19.

**Q32. Rewrite the editor?**
No. The graph logic of `Editor.vue` (history, groups, templates, sentinels,
port renames) stays. Its chrome is rebuilt with a 52 px top bar (name, state pill,
Enabled switch, save state, Discard, Test run ⌘↵, Save ⌘S, ⌘P switcher), the
palette on the left, a docked inspector on the right (tabs Settings / Last run / Docs), and a
bottom dock (Problems / Recent runs / Test payload). *Why:* the logic is tested
and dense. The findings are about chrome and feedback.

**Q33. Collapse the module sidebar in the builder (AU-19)?**
No. The DMS layout has no per-page sidebar option, and a module must not reach
into the layout's internals. The page uses `fillHeight` and drops its native
header (`hideHeader`). The bottom dock stays collapsed until it has something
to say, and the minimap is left out (it covered the nodes of a small canvas).
*Why:* most of the space is won by removing the header and the toolbar card.

**Q34. Unsaved changes (AU-04)?**
Save state in the top bar, Save/Discard instead of Apply/Cancel, and a
"Save changes to …?" dialog (Save and switch / Keep editing / Discard) when
switching procedure. Leaving the page goes through the DMS leave guard.
*Why:* the finding.

**Q35. Validation errors (AU-03)?**
The validator returns issues `{ message, nodeId? }`. The server answers them on
a refused save. The builder shows a problems banner, a Problems dock with
*Select node*, and marks the nodes. A graph with problems can be saved as a
disabled draft. Enabling it is refused while it has errors. *Why:* the finding.
The runtime already never fires a disabled procedure and validates before
running.

**Q36. Test run (AU-05)?**
`POST /api/automation/procedures/:id/test { graph, triggerNodeId?, payload }`
runs the draft without saving it and returns the run. The canvas overlays each
node's status, the dock lists the steps, the inspector's "Last run" tab shows
the node's input and output. The payload defaults to the last real call's
payload. When the draft is dirty, *Run now* asks which version to run.
*Why:* the finding. The executor already runs any graph from any trigger.

**Q37. Node labels and summaries (AU-10)?**
Nodes get an optional `label` (renamed in the inspector, and the schema already
passes extra fields through) and a one-line summary of their key setting
(HTTP method + host + path, humanized cron, webhook method + path, log message).
Categories get a color role (trigger cyan/info, flow amber/warning, data
green/success, action primary). *Why:* the finding. Traces and problems name
steps by label.

**Q38. Wired fields (AU-09)?**
Show "From <source label> · <port>" instead of the node id. *Why:* the finding.

**Q39. Secrets in headers (AU-12)?**
Not in this PR. The mockup puts secrets in workspace settings, which belong to
the DMS core. A module-local secret store would have to be migrated later. The
HTTP request inspector says credentials should not be typed into the graph.
*Why:* a secret store is a security feature that needs its own design, in the
DMS, not a side effect of a redesign.

**Q40. The builder's Runs drawer (AU-17)?**
Removed. The bottom dock lists this procedure's last runs with the run-history
row design and a trace link. "All runs" opens Run history filtered on the
procedure. *Why:* one run list design.

**Q41. Disabled banner (AU-16)?**
Names the trigger and, for a schedule, the next occurrence it would have had,
and has a one-click *Enable*. *Why:* the finding.

**Q42. Icons typed as strings (AU-14)?**
An icon picker grid (Phosphor icons common to automation) with a free-text
fallback, in Save as template and the template form. Save as template also
lists the ports inferred from the wires crossing the group. *Why:* the finding.

**Q43. Toasts (AU-18)?**
Every toast goes through the locale files and names the object. *Why:* French
users got English toasts.

## 9. Library

Review finding AU-13.

**Q44. How is the library composed?**
A DMS `Tab` block (Triggers, Actions, Data nodes, Templates, with counts from
`badgesUrl`). Each tab is a custom catalog in the DMS master/detail look: list
grouped by source module, detail with *Used by* (procedure, state, node, full
webhook URL with copy), the impact of disabling, node settings as a read-only
form, inputs/outputs as typed tables, the cluster behaviour in words, and the
global config JSON under *Advanced*. Templates: name, icon, description, ports,
used in, delete (forks each usage into a local group). *Why:* the finding. The
tab block exists, and a catalog is a master/detail no block draws.
Grilling also found that the Enabled switch was stored but never read by the
runtime. A disabled trigger type now stops being armed, a disabled action type
fails its step, and the switch takes effect at once on every instance.

## 10. Security and bugs found while grilling

**Q45. What else gets fixed on the way?**
Found while grilling, or while testing every screen in the playground:

- TableView data routes of procedures and runs accepted any signed-in user
  (`AuthRawUser`). They are owner-only now, like the rest of the module (Q10).
- Replay sent an empty body (Q27).
- The builder ignored `?selected=` from the procedures list (it always opened
  the first procedure) and listed only 20 procedures.
- Saving a template from the builder reset its icon to the default.
- Wired fields never rendered. The inspector named a component
  (`DmsAutomationEditorWiredField`) that was never registered.
- A trigger edge with no branch (hand-written or imported graphs) was dropped
  after any action. It now leaves by the main port, as the builder draws it.
- The library's Enabled switch had no effect (Q44).
- The HTTP request action sent an object body without a JSON content type, and
  failed GET/HEAD steps with fetch's cryptic error when a body was wired. The
  body is now dropped for those methods, with a warning in the run log.
- Selecting a node counted as an unsaved change (a sub-pixel position change),
  and ⌘S / ⌘↵ reopened a focused select.
- Built-in trigger and action names were English literals. They are i18n keys
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

## 11. Revisions after the QA pass

These revisions date from October 2026.

Every screen was then tested in the playground, page by page, and each fix was
checked again in the browser by someone other than its author. These answers
changed:

- **Q9.** The trace page no longer declares `requiredQueryParams`. Without a
  run, or with an unknown one, it says so inside the app instead of the DMS
  404.
- **Q14.** The overview no longer polls every 30 s. It refreshes on the
  realtime topics `automation.runs` and `automation.procedures` (a
  `LiveTopics` block, also on Run history), with the DMS Live / Pause toggle.
  A busy feed can be paused, which "no toggle" did not allow.
- **Q17.** The rules stand, with one addition. A procedure whose trigger
  cannot be armed (invalid schedule, webhook path taken) is *failing*, with
  the reason stored on the procedure so every instance agrees. An enabled
  procedure that never ran stays *healthy* and says "No run yet".
- **Q19.** To fit 1024 px, the last-run date sits under the last-runs strip,
  and the Avg column is hidden by default (it stays in the column picker).
- **Q30.** `version` now changes only when the graph changes. Concurrent saves
  are guarded by a separate `revision` counter (`expectedRevision`, 409 when
  stale), so a pause from the list no longer counts as a new version. Runs
  keep the names of their steps, and test runs the graph that ran. The trace
  draws the graph that actually ran, and says so when it was not kept.
- **Q33.** The minimap is still left out. The palette is collapsed by default
  under 1280 px, and the inspector sits beside the canvas instead of over it.
- **Q39.** Still no secret store, but a run no longer keeps credentials.
  Sensitive headers and query parameters are stored, shown and replayed as
  `[redacted]` (`runs.sensitiveNames` adds names), older runs included.
- **Q44.** The library no longer shows the global config JSON under
  *Advanced*, because the runtime never read it. The full webhook URL is built on the
  new `publicUrl` option.
- **Webhooks.** A path cannot overlap a route the server already serves, nor
  start with a reserved prefix (`/api`, `/auth`, `/dms`, `/modules`,
  `/settings`), and two enabled procedures cannot share a method and path.
