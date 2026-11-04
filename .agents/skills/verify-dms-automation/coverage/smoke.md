# Coverage of `smoke`

The journey every verdict runs. The other features carry the detail.

| Source | Documented behaviour | Catching journey and check |
|---|---|---|
| packages/dms-automation/docs/4.usage/3.builder.md:11 | The smallest procedure that runs is a Manual trigger and a Log action joined by an execution edge | `a-manual-trigger-and-a-log-action-run-and-are-traced`, checks `the steps are the trigger then the log` |
| packages/dms-automation/docs/4.usage/3.builder.md:11 | Message holds the text to write and Level is `info` by default | `a-manual-trigger-and-a-log-action-run-and-are-traced`, checks `the log step received the message` and `the level defaults to info` |
| packages/dms-automation/docs/4.usage/3.builder.md:13 | The message appears in the Logs of the run's trace | `a-manual-trigger-and-a-log-action-run-and-are-traced`, check `the message is in the run's Logs` |
| packages/dms-automation/docs/4.usage/3.builder.md:13 | Run now runs the saved version after Save (enable) | `a-manual-trigger-and-a-log-action-run-and-are-traced`, checks `Run now answers ok` and `the run's status` |
| packages/dms-automation/docs/4.usage/2.procedures.md:58 | Import JSON creates a disabled draft | `a-manual-trigger-and-a-log-action-run-and-are-traced`, check `it is disabled` |
| packages/dms-automation/docs/4.usage/4.runs.md:48 | The trace of a run can be linked | `a-manual-trigger-and-a-log-action-run-and-are-traced`, check on the trace page naming the procedure |
