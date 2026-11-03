# Coverage: builder

One row per documented behaviour. Journey ids are `builder/<id>` unless another feature is named.

| Source | Claim | Journey | Check |
|---|---|---|---|
| 3.builder.md:11 | The smallest procedure is a Manual trigger and a Log action joined by an edge | smoke/a-manual-trigger-and-a-log-action-run-and-are-traced | the steps are the trigger then the log |
| 3.builder.md:11 | Log has Message and Level, Level is `info` by default | smoke/a-manual-trigger-and-a-log-action-run-and-are-traced | the level defaults to info; builder/the-inspector-names-the-step-and-shows-its-settings-docs-and-last-run: a selected step shows Settings from its schema (Level `info`) |
| 3.builder.md:13 | Test run runs the draft without saving it, on the Test payload | builder/the-dock-offers-recent-runs-the-test-payload-and-the-test-run | the test ran the edited payload; run-now journey: Test run the draft tests without saving |
| 3.builder.md:13 | After Save, Run now runs the saved version | builder/run-now-runs-the-saved-version-and-asks-about-unsaved-changes | Run runs the saved procedure with the payload |
| 3.builder.md:13 | The message appears in the Logs tab of the run's trace | smoke/a-manual-trigger-and-a-log-action-run-and-are-traced | the message is in the run's Logs (trace page is owned by `trace`) |
| 3.builder.md:15 | Log calls no external service, a test runs it as it is | builder/a-test-that-would-act-for-real-asks-first-and-runs-nothing-if-cancelled | the listed steps omit Log and pure steps |
| 3.builder.md:15 | Log's message is stored with the run | Not driven here | owned by `redaction-and-retention` / `actions` |
| 3.builder.md:21-23 | Five areas: bar, palette, canvas, inspector, dock | builder/the-bar-holds-the-documented-controls-and-their-states, the-palette-groups..., the-inspector-names..., the-dock-offers... | one journey per area |
| 3.builder.md:25 | Bar: procedure switcher (Ctrl P) and Show/Hide blocks first | the-bar-holds-the-documented-controls-and-their-states | buttons left to right |
| 3.builder.md:25 | Ctrl P opens the switcher | ctrl-s-saves-ctrl-enter-tests-and-ctrl-p-switches-procedures | Ctrl P opens the switcher; picking a procedure opens it |
| 3.builder.md:26 | Bar: the procedure's name and state | the-bar-holds-the-documented-controls-and-their-states | the name field; page shows Draft |
| 3.builder.md:27 | Bar: Enabled switch and save state | the-bar-holds-the-documented-controls-and-their-states | switch Disabled/Enabled, save state Saved / 1 unsaved change / 2 unsaved changes |
| 3.builder.md:28 | Discard, Run now, Test run (Ctrl Enter), Save (Ctrl S) in that order | the-bar-holds-the-documented-controls-and-their-states | buttons left to right |
| 3.builder.md:28 | Discard restores the saved procedure | the-bar-holds-the-documented-controls-and-their-states | Discard restores the saved procedure |
| 3.builder.md:28 | Ctrl S saves | ctrl-s-saves-ctrl-enter-tests-and-ctrl-p-switches-procedures | Ctrl S saves from the name field |
| 3.builder.md:28 | Ctrl Enter runs a test | ctrl-s-saves-ctrl-enter-tests-and-ctrl-p-switches-procedures | Ctrl Enter runs a test |
| 3.builder.md:29 | More actions: New procedure, Export JSON, View all runs, Delete procedure | the-bar-holds-the-documented-controls-and-their-states | the More actions menu (items, View all runs href); New procedure opens the dialog |
| 3.builder.md:29 | Delete procedure deletes (graph for good) | Not driven here | the deletion and its confirmation text belong to `procedures` (`delete-confirm`, `delete-takes-the-graph-and-keeps-the-runs`) |
| 3.builder.md:29 | Export JSON | export-json-downloads-the-procedure-and-import-recreates-it | the downloaded file; importing it re-creates the procedure as a disabled draft |
| 3.builder.md:31 | On macOS, ⌘ replaces Ctrl | ctrl-s-saves-ctrl-enter-tests-and-ctrl-p-switches-procedures | macOS prints the command key |
| 3.builder.md:33 | Palette groups Triggers, Actions, Flow, Helpers, Data, Templates | the-palette-groups-blocks-by-module-and-category-and-searches-them | the groups, in order, with the library's counts; a template adds the Templates group, last |
| 3.builder.md:33 | Built-in blocks first, then one section per module | the-palette-groups-blocks-by-module-and-category-and-searches-them | built-in blocks come first, then one section per module |
| 3.builder.md:33 | Built-in data nodes split by category | the-palette-groups-blocks-by-module-and-category-and-searches-them | Data: categories in order, then modules; each category's blocks |
| 3.builder.md:33 | Search blocks… filters | the-palette-groups-blocks-by-module-and-category-and-searches-them | search matches names, ids and descriptions; No blocks match |
| 3.builder.md:33 | Click a block adds it after the selected step | a-clicked-block-is-added-after-the-selected-step | Delay lands after Log; the saved chain |
| 3.builder.md:33 | Drag a block onto the canvas | Not driven | HTML5 drag of a palette block is not reproducible with Playwright mouse drags in this skill; the click path is driven |
| 3.builder.md:33 | A type switched off in the Library shows Off, and its steps fail | the-palette-groups-blocks-by-module-and-category-and-searches-them | a type switched off is marked Off (marker and hint); failing steps are owned by `library`/`actions` |
| 3.builder.md:35 | A trigger edge sets the order and joins right handle to left handle | a-clicked-block-is-added-after-the-selected-step; wires-are-drawn-between-matching-ports-replaced-and-unwired | the saved chain; trigger edges after Unwire |
| 3.builder.md:35 | A data edge joins an output port to an input field | wires-are-drawn-between-matching-ports-replaced-and-unwired | a data link shows From <step · port> with Unwire |
| 3.builder.md:35 | A trigger port (blue) links only to a trigger port, a data port (green) only to a data port | wires-are-drawn-between-matching-ports-replaced-and-unwired | trigger ports are blue and data ports green; a trigger port does not link to a data port |
| 3.builder.md:35 | A port reads as its field's title when declared, else its key; hover shows the key | Not driven | needs a fixture action whose schema declares `$` titles; the fixture's effect action declares plain `title: "Label"` only (inspector label path is covered by the HTTP request fields) |
| 3.builder.md:37 | Inspector: Step name, Settings from the schema, Docs | the-inspector-names-the-step-and-shows-its-settings-docs-and-last-run | a selected step shows Settings from its schema; Docs shows the block's description; a typed name labels the node |
| 3.builder.md:37 | Last run tab shows what the step did, titled This run failed when it failed | the-inspector-names-the-step-and-shows-its-settings-docs-and-last-run | after a test the failed step has a Last run tab; it is titled This run failed |
| 3.builder.md:37 | A schedule trigger shows its next run | the-inspector-names-the-step-and-shows-its-settings-docs-and-last-run | a schedule trigger shows its next run |
| 3.builder.md:39 | Dock tabs Problems, Recent runs, Test payload | the-dock-offers-recent-runs-the-test-payload-and-the-test-run | the dock's tabs |
| 3.builder.md:39 | After a test, a Test run tab lists the steps that ran | the-dock-offers-recent-runs-the-test-payload-and-the-test-run | the Test run tab lists the steps in order |
| 3.builder.md:45 | A field takes a typed value or a wired value | wires-are-drawn-between-matching-ports-replaced-and-unwired | a data link shows From ... (wired replaces the typed field); Unwire returns it |
| 3.builder.md:45 | Wired sources: webhook body, headers, query; action result; data node output | Not driven here | webhook payload wiring belongs to `webhooks`; action results and data node outputs to `data-nodes` / `actions` |
| 3.builder.md:47 | Inspector shows "From <step · port>" with Unwire to remove the link | wires-are-drawn-between-matching-ports-replaced-and-unwired | a data link shows From <step · port> with Unwire; Unwire removes the link |
| 3.builder.md:47 | Solid execution line sets when, dashed data line supplies the value | Not driven | line styles are not exposed in the ARIA tree; the edges themselves are checked |
| 3.builder.md:52 | Keep credentials out of the graph (builder hint) | Not driven | prose advice; the credentials hint in the HTTP request inspector is a wording, not a behaviour |
| 3.builder.md:59-67 | Flow nodes If, Switch, For each, For range, Parallel, Try / Catch, Retry | the-palette-groups-blocks-by-module-and-category-and-searches-them | Flow: blocks (the nodes exist, in order); their behaviour is owned by `flow` |
| 3.builder.md:67 | Retry runs its body up to Max attempts times, then goes on from `exhausted` | Not driven here | owned by `flow` |
| 3.builder.md:69 | Helpers group holds Delay and Set variable | the-palette-groups-blocks-by-module-and-category-and-searches-them | Helpers: blocks |
| 3.builder.md:69 | Wrap in Retry puts a step inside a Retry in one click | wrap-in-retry-puts-a-step-inside-a-retry | the step now sits inside a Retry |
| 3.builder.md:73 | Select several steps, Group (N) folds them into one node with its own ports | selected-steps-fold-into-a-group-with-ports-that-keeps-the-procedure-running | two steps selected; the steps fold into one group node; the stored group |
| 3.builder.md:73 | Group ports edits the ports | selected-steps-fold-into-a-group-with-ports-that-keeps-the-procedure-running | Group ports renames a port and the wire follows |
| 3.builder.md:73 | Enter group works on the steps inside | selected-steps-fold-into-a-group-with-ports-that-keeps-the-procedure-running | Enter group shows the steps inside; Escape leaves the group |
| 3.builder.md:73 | Ungroup | Not driven | the builder has no ungroup control (no such label in i18n); a template fork and Enter group are the ways out |
| 3.builder.md:77 | Save as template makes the group reusable | a-group-saved-as-a-template-is-linked-read-only-and-forkable | the template is stored with the group's ports and steps |
| 3.builder.md:77 | An instance displays Linked; steps and ports come from the template; port controls read-only | a-group-saved-as-a-template-is-linked-read-only-and-forkable | the linked instance |
| 3.builder.md:77 | Edit template changes the shared definition | a-group-saved-as-a-template-is-linked-read-only-and-forkable | Edit template opens the template in the builder; templates/editing-a-template-changes-every-procedure-placing-it for the effect on procedures |
| 3.builder.md:77 | Fork to local group makes a private copy | a-group-saved-as-a-template-is-linked-read-only-and-forkable | the fork dialog; the saved copy is private |
| 3.builder.md:83 | Test run runs the draft unsaved on the test payload | the-dock-offers-recent-runs-the-test-payload-and-the-test-run | the test ran the edited payload |
| 3.builder.md:83 | Test payload is filled from the last real call | the-dock-offers-recent-runs-the-test-payload-and-the-test-run | the payload is prefilled from the last real call |
| 3.builder.md:83 | The run is kept with a trace, shown on the canvas, never counts in the figures | the-inspector-names-the-step-and-shows-its-settings-docs-and-last-run | after a test the failed step has a Last run tab (canvas); never counting is owned by `test-runs` |
| 3.builder.md:83 | Actions with no side effects run as usual; actions with a dry run are simulated | a-test-that-would-act-for-real-asks-first-and-runs-nothing-if-cancelled | Test for real runs the draft: simulated where possible |
| 3.builder.md:83 | Steps that would act for real are listed in Test with real effects?, the test starts only after Test for real, nothing runs on cancel | a-test-that-would-act-for-real-asks-first-and-runs-nothing-if-cancelled | the confirmation names the step; Cancel runs nothing; several steps read in the plural |
| 3.builder.md:84 | Run now runs the saved procedure with an editable payload defaulting to the last payload | run-now-runs-the-saved-version-and-asks-about-unsaved-changes | the dialog before any call; the payload defaults to the last call; invalid JSON is refused |
| 3.builder.md:84 | With unsaved changes, the builder asks to run the saved version or test the draft | run-now-runs-the-saved-version-and-asks-about-unsaved-changes | unsaved changes raise the question; Test run the draft tests without saving |
| 3.builder.md:85 | Problems lists what blocks enabling (missing field), each with Select node | an-enabled-procedure-with-problems-is-saved-as-a-draft | the Problems tab lists the problem; Select node jumps to the node |
| 3.builder.md:85 | Problems: a broken edge, a webhook path already taken | Not driven here | graph problem codes are owned by `procedures` (validate) and `webhooks`; only the missing-field problem is driven in the dock |
| 3.builder.md:85 | Saving an enabled procedure with problems is refused and offers Save as draft (saved disabled) | an-enabled-procedure-with-problems-is-saved-as-a-draft | the refused save; Save as draft saves it disabled |
| 3.builder.md:85 | Nothing fires until the problems are fixed | an-enabled-procedure-with-problems-is-saved-as-a-draft | it can now be enabled (after the fix) |
| 3.builder.md:88 | Run now runs every action for real; HTTP/module actions without a dry run act for real after confirmation | run-now-runs-the-saved-version-and-asks-about-unsaved-changes | the dialog before any call (Side effects are real sentence); test confirmation in the real-effects journey |
| 3.builder.md:88 | Use test services (advice) | Not driven | prose advice |
| 5.extending.md:59 | The builder lists the node in its palette under the module's name | the-palette-groups-blocks-by-module-and-category-and-searches-them | Triggers/Actions/Data module sections `app` and `dms` |
| 5.extending.md:90 | Before the test starts, the builder lists a step with no declaration and asks to confirm | a-test-that-would-act-for-real-asks-first-and-runs-nothing-if-cancelled | the confirmation names the step that acts for real |
| 6.faq.md:44 | Test runs never count in the figures | Not driven here | owned by `test-runs` |
| 6.faq.md:54 | Palette does not group nodes by module when attribution is unavailable (log line) | Not driven | needs an older interface/module pair to make attribution fail |
| 5.library.md:25 | A type switched off shows in the palette as Off | the-palette-groups-blocks-by-module-and-category-and-searches-them | a type switched off is marked Off |
| skills/dms-automation/SKILL.md:15 | Builder page `/modules/automation/builder?selected=<id>` | the-bar-holds-the-documented-controls-and-their-states | the URL used by every builder journey; a deleted procedure shows the notice (draft journey) |
| skills/dms-automation/SKILL.md:17 | A procedure exported from the builder is re-created by import as a disabled draft | export-json-downloads-the-procedure-and-import-recreates-it | importing it re-creates the procedure as a disabled draft |
| i18n editor.* | Draft / paused banner, Enable, empty and missing procedure notices | a-draft-says-nothing-fires-until-it-is-enabled-and-offers-to-enable-it | a scheduled draft says when it would fire; Enable enables and saves; a paused procedure says it is paused; no procedure; deleted procedure link |
| i18n editor.stale | Saving a procedure changed elsewhere asks Keep editing / Reload / Overwrite | Not driven | would need a second tab saving between load and Save; not yet journeyed |
