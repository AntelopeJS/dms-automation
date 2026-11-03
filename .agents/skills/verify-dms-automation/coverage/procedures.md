# Coverage: procedures

Journey ids are `procedures/<id>`. Docs are 4.usage/2.procedures.md unless another file is named.

| Source | Claim | Journey | Check |
|---|---|---|---|
| 2.procedures.md:14 | Failing: enabled and last run failed, or trigger cannot be armed; the reason is the state's detail | states-follow-the-runs-as-the-docs-define-them | failing by run and by arm, with detail texts |
| 2.procedures.md:15 | Degraded: enabled, last run succeeded, failures in 7 days, count shown | states-follow-the-runs-as-the-docs-define-them | degraded count text |
| 2.procedures.md:16 | Healthy; a procedure that never ran is healthy with No run yet | pause-and-resume-change-only-whether-it-is-enabled | "enabled with no run yet is Healthy with No run yet" |
| 2.procedures.md:17 | Paused: disabled after enabled or after it ran | pause-and-resume-change-only-whether-it-is-enabled; states-follow-the-runs-as-the-docs-define-them | a paused procedure reads Paused |
| 2.procedures.md:18 | Draft: no trigger, or disabled and never enabled nor run | new-procedure-makes-a-disabled-draft-with-its-trigger-in-place; states-follow-... | summary status draft |
| 2.procedures.md:23 | Test runs never count in the states | states-follow-the-runs-as-the-docs-define-them | test run does not change the state |
| 2.procedures.md:36 | Last runs holds the last 12 runs | last-runs-draws-twelve-runs-and-success-is-the-share-of-successes | 15 runs, 12 in the strip, oldest first |
| 2.procedures.md:37 | Success is the share of successes over 7 days | last-runs-draws-twelve-runs-and-success-is-the-share-of-successes | success percentage |
| 2.procedures.md:48 | Run now runs the saved version with the last real call's payload, or empty | run-now-sends-the-payload-of-the-last-real-call | last-payload per trigger, empty when never called, tests never count |
| 2.procedures.md:49 | Pause disables an enabled procedure | pause-and-resume-change-only-whether-it-is-enabled | enabled false, pausedAt/pausedBy |
| 2.procedures.md:50 | Resume enables a paused procedure | pause-and-resume-change-only-whether-it-is-enabled | resume leaves the pause time; undo restores it |
| 2.procedures.md:53 | Duplicate creates a disabled copy `<name> (copy)`, webhooks moved to free paths | duplicate-makes-a-disabled-copy-with-free-webhook-paths | name, disabled, paths moved, 404 for unknown id |
| 2.procedures.md:58 | New procedure: name, starter webhook/schedule/manual, optional description; disabled draft with the trigger in place | new-procedure-makes-a-disabled-draft-with-its-trigger-in-place | each starter read back by GET, summary, export |
| 2.procedures.md:58 | Webhook starter path from the name | new-webhook-procedure-takes-its-path-from-the-name | slug, accents, CJK, 40 cut, -2/-3 |
| 2.procedures.md:58 | Name 1-200, description 2000 | new-procedure-refuses-what-the-limits-forbid | 200/201, 2000/2001, trim, 400 field path |
| 2.procedures.md:59 | Import takes what Export JSON gives, makes a disabled draft | import-json-creates-a-disabled-draft-from-an-export | round trip, unicode, webhook paths moved, problems listed |
| 2.procedures.md:59 | Non-exported JSON or unknown step kind refused with the reason | import-json-refuses-what-is-not-an-exported-procedure | not JSON, no name, no graph, unknown kind, bad graph, array |
| SKILL.md:17 | import `{ json }` creates a disabled draft; PUT enabled `{ enabled }` enables; run-now `{ payload }` runs | import-json-creates-...; pause-and-resume-...; run-now-sends-... | status codes and bodies |
| SKILL.md:17 | Enabling is refused while the graph cannot run | enabling-is-refused-while-the-graph-cannot-run | no trigger, missing field, unknown type, taken and reserved path, bad cron |
| 6.faq.md:9 | A trigger that cannot be armed makes the procedure Failing with the reason | states-follow-the-runs-as-the-docs-define-them | arm failure detail |
| 1.introduction (TSDoc) | A taken name warns but is allowed | a-taken-name-warns-and-is-created-anyway | warning on new, import, validate |
| TSDoc procedures.ts update | Save needs the open revision; stale is a 409; version moves only when execution changes; rename renames runs | saving-moves-the-revision-and-the-version-only-when-a-run-would-differ | stale body, version 1/2/3, runs renamed |
| TSDoc procedures.ts update | Pausing by save records when and by whom | saving-moves-the-revision-and-the-version-only-when-a-run-would-differ | pausedBy, pausedAt |
| TSDoc procedures.ts | Validation of save body | saving-moves-the-revision-and-the-version-only-when-a-run-would-differ | nine refused bodies by field; 200/2000 accepted |
| TSDoc procedures.ts | Validate lists problems of a draft graph | validate-lists-the-problems-of-a-draft-graph | warning on draft, error when enabling |
| TSDoc deleteConfirm.ts | Delete dialog worded for the procedure: runs this week, Pause suggested, name to type, what stops | delete-confirmation-is-worded-for-the-procedure | dialog fields for draft, enabled, webhook, schedule |
| 2.procedures.md:62 | Delete removes the graph for good, stops its triggers; run history stays | delete-takes-the-graph-and-keeps-the-runs | 404 on the id, webhook gone, runs still listed |
| 2.procedures.md:62 | Enabled delete says how often it ran this week | delete-confirmation-is-worded-for-the-procedure | run count in the text |
| Overview docs | Dismiss hides a degraded procedure until it fails again; Undo | dismiss-hides-a-degraded-procedure-until-it-fails-again | attention list before and after, 404s |
| TSDoc procedures.ts | Triggers listed in words with next schedule time | triggers-are-listed-in-words-with-the-next-schedule-time | texts and next run |
| TSDoc requests.ts | List: 20 per page by default, max 200, newest first, bad page 400 invalidPage | the-list-pages-newest-first-and-refuses-bad-pages | paging and six bad values |
| TSDoc procedures.ts runs | Runs of a procedure newest first, one extra row to tell a next page, bad page 400, unknown 404 | the-runs-of-a-procedure-list-newest-first-and-page | order, extra row, page 1, bad queries |
| (router) | Other methods are not routes | routes-the-module-does-not-serve-answer-404-and-change-nothing | 17 wrong method/path pairs plus HEAD, ids |
| TSDoc procedures.ts | Test and test-effects routes | Not driven here: covered by the test-runs feature | |
| 2.procedures.md:35 | Event trigger wording (User registered) | Not driven: needs the DMS event trigger; triggers feature | |
| 2.procedures.md:39 | Avg is the average run duration, not the newest or the slowest | `avg-is-the-average-run-duration-not-the-newest` | check `avgDurationMs is the mean, 300` over runs of 100, 200 and 600 ms |
| 2.procedures.md:62 | The delete confirmation counts the runs of this week only: 6 days ago counts, 8 days ago does not | `the-delete-confirmation-counts-only-the-runs-of-this-week` | check `two runs this week` |
