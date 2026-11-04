# Coverage: procedures-page

Journey ids are `procedures-page/<id>` unless another feature is named. Docs file is 4.usage/2.procedures.md.

| Source | Claim | Journey | Check |
|---|---|---|---|
| 2.procedures.md:6 | The page lives at /modules/automation/procedures and lists every procedure with trigger and 7-day result | the-list-shows-five-columns-with-each-state-and-its-reason | seven rows; the footer counts them |
| 2.procedures.md:14 | Failing: enabled, last run failed or trigger cannot be armed, reason under the state | the-list-shows-five-columns-with-each-state-and-its-reason | rows 1 and 2 read Failing with "Trigger not armed: ..." and the failed step |
| 2.procedures.md:15 | Degraded: last run succeeded, failures in 7 days, count under the state | the-list-shows-five-columns-with-each-state-and-its-reason | row 3 reads "1 of 2 failed in 7 days" |
| 2.procedures.md:16 | Healthy: no failure in 7 days; never ran is healthy with No run yet | the-list-shows-five-columns-with-each-state-and-its-reason; live-and-pause-hold-the-rows-and-count-the-changes | rows 4 and 5; "a procedure that has not run is Healthy with No run yet" |
| 2.procedures.md:17 | Paused: disabled after it was enabled or ran | the-list-shows-five-columns-with-each-state-and-its-reason | row 6 reads Paused |
| 2.procedures.md:18 | Draft: no trigger, or disabled and never enabled nor run | the-list-shows-five-columns-with-each-state-and-its-reason | row 7 reads Draft, No trigger yet |
| 2.procedures.md:21 | States move live as runs land and procedures change | live-and-pause-hold-the-rows-and-count-the-changes | a run moves its row to Failing; a new procedure appears (FAILS: dms-automation-procedures-live-list-does-not-take-new-procedures) |
| 2.procedures.md:21 | The bar says when the list was updated | the-list-shows-five-columns-with-each-state-and-its-reason; live-and-pause-hold-the-rows-and-count-the-changes | "Updated N s ago" |
| 2.procedures.md:21 | Pause keeps the rows as they stand; N new · Show counts the changes since | live-and-pause-hold-the-rows-and-count-the-changes | Paused rows stay; "Paused · 1 new"; Show brings the row in (FAILS with the live issue) |
| 2.procedures.md:23 | Test runs never count in these states | procedures/states-follow-the-runs-as-the-docs-define-them | test runs left out of the state |
| 2.procedures.md:25 | Tabs Failing, Degraded, Healthy, Paused, Drafts filter by state | tabs-filter-by-state-and-show-their-counts | each tab lists its state; All order |
| 2.procedures.md:25 | The tabs show their counts | tabs-filter-by-state-and-show-their-counts | tabs and counts (FAILS: dms-automation-procedures-tab-counts-never-load) |
| 2.procedures.md:25 | The Trigger type filter, the search and column filters narrow the list | tabs-filter-by-state-and-show-their-counts | Webhook keeps only the webhook procedure; search by path, last error, accent, cron, no match text |
| 2.procedures.md:31 | Five columns | the-list-shows-five-columns-with-each-state-and-its-reason | the five columns, in order |
| 2.procedures.md:33 | Procedure is the name with description under it | the-list-shows-five-columns-with-each-state-and-its-reason | row 5 "Okay one does things" |
| 2.procedures.md:34 | Status is the state with its reason under it | the-list-shows-five-columns-with-each-state-and-its-reason | rows 1-4 |
| 2.procedures.md:35 | Starts when describes the trigger in words (Every hour..., Weekdays at 08:00 (UTC), POST /hooks/stripe) | the-list-shows-five-columns-with-each-state-and-its-reason | rows 4 and 6 |
| 2.procedures.md:35 | Under a webhook or schedule the cell names the trigger type; more triggers say how many more | the-list-shows-five-columns-with-each-state-and-its-reason | "Webhook", "Schedule (cron) · +1 more" |
| 2.procedures.md:35 | User registered style event wording | Not driven: needs the DMS event trigger types; wording is the triggers feature's `describe` path | |
| 2.procedures.md:36 | Last runs draws the last 12 runs, green or red, with time of the last; each mark opens the trace | the-list-shows-five-columns-with-each-state-and-its-reason; procedures/last-runs-draws-twelve-runs-and-success-is-the-share-of-successes | marks open /trace?run=; the strip draws 12 |
| 2.procedures.md:37 | Success is the share of successful runs over 7 days | the-list-shows-five-columns-with-each-state-and-its-reason | 0%, 50%, 100% |
| 2.procedures.md:39 | The column picker adds Description, Last error, Enabled, Trigger type, Avg | the-column-picker-adds-description-last-error-enabled-trigger-type-and-avg | each column added shows its values |
| 2.procedures.md:43 | Click a name or double-click a row opens the builder | row-actions-pause-resume-duplicate-run-now-and-the-links-do-what-the-docs-say | opening: by name, by double click, selected id |
| 2.procedures.md:43 | Row menu holds eight actions | the-row-menu-offers-the-documented-actions-for-each-state | menus by state |
| 2.procedures.md:47 | Open in builder | row-actions-pause-resume-duplicate-run-now-and-the-links-do-what-the-docs-say | builder?selected=id |
| 2.procedures.md:48 | Run now: saved version, last real payload or empty, after confirmation, real side effects; drafts do not have it | row-actions-pause-resume-duplicate-run-now-and-the-links-do-what-the-docs-say; the-row-menu-offers-the-documented-actions-for-each-state | question and warning text; Cancel runs nothing; confirming runs once; draft menu has no Run now. Payload: procedures/run-now-sends-the-payload-of-the-last-real-call |
| 2.procedures.md:49 | Pause disables an enabled procedure | row-actions-pause-resume-duplicate-run-now-and-the-links-do-what-the-docs-say | Pause toast, procedure is paused |
| 2.procedures.md:50 | Resume enables a paused procedure | row-actions-pause-resume-duplicate-run-now-and-the-links-do-what-the-docs-say | Resume toast, enabled again |
| 2.procedures.md:51 | Open last run when there is one | the-row-menu-offers-the-documented-actions-for-each-state; row-actions-... | absent without a run; opens trace?run= |
| 2.procedures.md:52 | View runs opens the Run history on this procedure | row-actions-pause-resume-duplicate-run-now-and-the-links-do-what-the-docs-say | /runs with procedure= |
| 2.procedures.md:53 | Duplicate creates a disabled copy named `<name> (copy)` | row-actions-...; procedures/duplicate-makes-a-disabled-copy-with-free-webhook-paths | toast; copy disabled and named; webhook paths moved |
| 2.procedures.md:54 | Delete after a confirmation | delete-asks-first-and-an-enabled-procedure-by-typing-its-name | draft and enabled dialogs; row gone, 404 |
| 2.procedures.md:58 | New procedure asks name, trigger (A webhook is called, On a schedule, I run it) and optional description | new-procedure-dialog-creates-a-disabled-draft-and-opens-the-builder | title, subtitle, fields and starter hints |
| 2.procedures.md:58 | Create and open the builder creates a disabled draft with the trigger in place and opens the builder | new-procedure-dialog-creates-a-disabled-draft-and-opens-the-builder | builder opens; draft has one manual trigger, disabled; empty name creates nothing |
| 2.procedures.md:59 | Import JSON takes the content Export JSON downloads | import-json-dialog-creates-a-draft-or-says-why-not | a valid export is imported with name, description, graph |
| 2.procedures.md:59 | Import and open the builder creates a disabled draft and opens the builder | import-json-dialog-creates-a-draft-or-says-why-not | builder opens; draft disabled |
| 2.procedures.md:59 | Problems in the builder lists graph problems | Not driven here: Problems dock is the builder feature (builder/ problems journeys); the import API lists problems in procedures/import-json-creates-a-disabled-draft-from-an-export | |
| 2.procedures.md:59 | Non-exported JSON or an unknown kind of step is refused with the reason | import-json-dialog-creates-a-draft-or-says-why-not | four refusal texts under the field |
| 2.procedures.md:62 | Deleting deletes the graph for good; Export JSON first | delete-asks-first-and-an-enabled-procedure-by-typing-its-name | draft dialog text |
| 2.procedures.md:62 | Enabled: confirmation says how often it ran this week and suggests Pause | delete-asks-first-and-an-enabled-procedure-by-typing-its-name | "ran 2 times this week", Pause suggestion; name typed |
| 2.procedures.md:62 | Run history stays until retention removes it | delete-asks-first-and-an-enabled-procedure-by-typing-its-name; procedures/delete-takes-the-graph-and-keeps-the-runs | dialog text; runs still listed after delete |
| 2.procedures.md:1 | Page header lists the empty state and both buttons | an-empty-list-offers-the-first-procedure | No procedures yet; Import JSON and New procedure |
| 1.introduction.md:19 | Procedures page: new and import dialogs | new-procedure-dialog-...; import-json-dialog-... | dialogs |
