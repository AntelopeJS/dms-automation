# Coverage: trace

Docs: `packages/dms-automation/docs/4.usage/4.runs.md` (Re-run a run, Run trace), `docs/6.faq.md`. Journeys are in `journeys/trace.mjs` (+ `journeys/parts/trace-rerun.mjs`, `trace-seed.mjs`).

| Source | Documented behaviour | Journey | Check |
| --- | --- | --- | --- |
| 4.runs.md:29 | Re-run runs the current saved graph with the original trigger and stored payload | a-re-run-runs-the-current-saved-graph-with-the-stored-payload | the current graph ran: both effect steps, the first with the original payload |
| 4.runs.md:29 | It does not run a historical copy of the graph | a-re-run-runs-the-current-saved-graph-with-the-stored-payload | stored as a re-run of the original, version 2; the original is untouched: one effect step, version 1 |
| 4.runs.md:29 | A re-run of a test runs the draft again and is stored as a test | a-re-run-of-a-test-runs-the-draft-again-and-is-stored-as-a-test | the draft ran again, not the saved graph; stored as a test, not rerun, without a version |
| 4.runs.md:31 | Confirmation titled "Re-run with the same payload?" | the-re-run-confirmation-warns-in-the-words-of-the-run | the dialog: title and description |
| 4.runs.md:31 | It warns that side effects are real | the-re-run-confirmation-warns-in-the-words-of-the-run | the dialog: title and description (Side effects are real.) |
| 4.runs.md:31 | A paused procedure still runs once | a-re-run-of-a-paused-procedure-runs-once-and-a-failed-one-warns | the re-run ran the procedure once; and the procedure is still paused |
| 4.runs.md:31 | The confirmation says the procedure is paused | the-re-run-confirmation-warns-in-the-words-of-the-run | paused line |
| 4.runs.md:31 (i18n) | A failing re-run answers with a warning | a-re-run-of-a-paused-procedure-runs-once-and-a-failed-one-warns | a failing re-run |
| 4.runs.md:31 (i18n) | A re-run of the same run asked twice in a row is refused | a-re-run-runs-the-current-saved-graph-with-the-stored-payload | a second re-run at once is refused; it runs again after about 5 seconds |
| 4.runs.md:35 | Re-run refused when the procedure was deleted | a-re-run-is-refused-for-a-deleted-procedure-a-missing-trigger-a-large-payload-and-a-lost-draft | refused: deleted |
| 4.runs.md:36 | Refused when the trigger is no longer in the procedure | a-re-run-is-refused-for-a-deleted-procedure-a-missing-trigger-a-large-payload-and-a-lost-draft | refused: trigger gone; the dialog for trigger gone |
| 4.runs.md:37 | Refused when the payload was too large to keep | a-re-run-is-refused-for-a-deleted-procedure-a-missing-trigger-a-large-payload-and-a-lost-draft | refused: payload too large; the dialog for payload too large |
| 4.runs.md:38 | Refused when the run is a test whose draft was not kept | a-re-run-is-refused-for-a-deleted-procedure-a-missing-trigger-a-large-payload-and-a-lost-draft | refused: draft not kept; the dialog for draft not kept |
| 4.runs.md:41 | A re-run sends `[redacted]` in place of credentials and its confirmation says so | the-re-run-confirmation-warns-in-the-words-of-the-run | redacted line names the headers; see also redaction-and-retention |
| 4.runs.md:46 | The trace is at `/modules/automation/trace?run=<runId>` and can be linked | the-trace-header-and-figures-describe-a-succeeded-run | the header |
| 4.runs.md:50 | The header names the procedure, the run id and when and how the run started | the-trace-header-and-figures-describe-a-succeeded-run | procedure, outcome, run id, start, trigger, instance; Started <date> · Manual |
| 4.runs.md:50 | Previous run, Next run, Re-run with this payload and Debug in builder sit beside it | the-trace-header-and-figures-describe-a-succeeded-run | Previous run and Next run, each with its outcome; Previous run opens the run before |
| 4.runs.md:50 | Debug in builder opens the builder on the procedure and the run | a-failed-run-names-the-step-how-long-how-often-the-error-and-the-last-success | Debug in builder opens the procedure on the run |
| 4.runs.md:51 | The failure card names the step that failed | a-failed-run-names-the-step-how-long-how-often-the-error-and-the-last-success | the card names step, time, streak, error |
| 4.runs.md:51 | After how long, how many times in a row, and its error | a-failed-run-names-the-step-how-long-how-often-the-error-and-the-last-success | failures in a row since the last success; the card names step, time, streak, error |
| 4.runs.md:51 | A link to the last success | a-failed-run-names-the-step-how-long-how-often-the-error-and-the-last-success | the link to the last success carries its id |
| 4.runs.md:51 | Open this step opens the builder on that step | a-failed-run-names-the-step-how-long-how-often-the-error-and-the-last-success | Open this step opens the builder on the failed step |
| 4.runs.md:52 | Status figure with the step reached | a-failed-run-names-the-step-how-long-how-often-the-error-and-the-last-success | Status: Failed at step 3 of 4 |
| 4.runs.md:52 | Duration against the usual one | a-failed-run-names-the-step-how-long-how-often-the-error-and-the-last-success | the usual duration is the mean of the successes around it; Duration against the usual one |
| 4.runs.md:52 | Trigger and Procedure version figures | the-trace-header-and-figures-describe-a-succeeded-run | the four figures |
| 4.runs.md:53 | Steps lays every step on a time line with its output | the-trace-tabs-show-steps-path-only-payload-and-logs | Steps |
| 4.runs.md:53 | Path only keeps only the steps on the path the run took | the-trace-tabs-show-steps-path-only-payload-and-logs | Path only |
| 4.runs.md:53 | Payload shows what the trigger received | the-trace-tabs-show-steps-path-only-payload-and-logs | Payload |
| 4.runs.md:53 | Logs shows what each step logged | the-trace-tabs-show-steps-path-only-payload-and-logs | Logs |
| 4.runs.md:54 | Path taken lists the steps the run went through | the-trace-header-and-figures-describe-a-succeeded-run | the path taken and the empty comparison |
| 4.runs.md:54 | Open in builder shows the path on the graph | the-trace-tabs-show-steps-path-only-payload-and-logs | Open in builder |
| 4.runs.md:55 | Compared with the last success: time of each step next to the last run that succeeded, the gap | a-failed-run-names-the-step-how-long-how-often-the-error-and-the-last-success | comparison rows: step, last success, now, gap |
| 4.runs.md:55 | Names the steps this run never reached | a-failed-run-names-the-step-how-long-how-often-the-error-and-the-last-success | the step never reached; comparison rows (not reached) |
| 4.runs.md:56 | A banner says when the run used an older version | a-run-of-an-older-version-and-a-re-run-are-bannered-in-the-trace | the old run's trace |
| 4.runs.md:56 | A banner says when the run is a re-run, with Open the original run | a-run-of-an-older-version-and-a-re-run-are-bannered-in-the-trace | the re-run's trace; Open the original run |
| 4.runs.md:58 | For a test run Debug in builder and Open this step are disabled | a-test-run-trace-disables-debug-in-builder-and-open-this-step | Debug in builder is disabled; Open this step is disabled |
| 4.runs.md:58 | Their hint says the builder opens the saved procedure, not the draft | a-test-run-trace-disables-debug-in-builder-and-open-this-step | the hint under the failure |
| 4.runs.md:50 (i18n) | Empty states: No run given, This run doesn't exist, procedure deleted | the-trace-says-when-no-run-is-given-the-run-is-unknown-or-its-procedure-deleted | no run, unknown run; deleted |
| 4.runs.md:44 (TSDoc historyOf) | A test is compared with the tests, a run with the runs | a-test-run-trace-disables-debug-in-builder-and-open-this-step | the trace of a test (Draft tile, no comparison) |
| 4.runs.md (route) | Run API gives the trace, skipped steps, edges taken, previous, next, usual duration, last success | a-failed-run-names-the-step-how-long-how-often-the-error-and-the-last-success | the failed run as the API gives it |
| 6.faq.md:44 | A test run is stored with its trace | a-test-run-trace-disables-debug-in-builder-and-open-this-step | the test run |
| 6.faq.md:40 | The confirmation warns, followed by the header names | the-re-run-confirmation-warns-in-the-words-of-the-run | the confirmation by API (headers first, then the query, with their case) |
| 4.runs.md:56 | A run whose graph is gone has steps named from what the run kept, skipped steps are not shown | a-run-of-an-older-version-and-a-re-run-are-bannered-in-the-trace | the old run's trace (graph of v1 not kept) |
| Not covered | The info banner "This run used v{n} of the procedure" | Not driven | unreachable: it shows only when the run's graph is not flagged outdated, and a run of an older version always is (same condition in `routes/runs.ts` and `RunTrace.vue`); the graph-not-kept banner is driven instead |
| Not covered | Retries, loops, groups in the trace (iteration, attempt, caught) | Not driven | belongs to flow journeys (owner B); the trace of those steps is read there |
