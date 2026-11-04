---
covers:
  - packages/dms-automation/src/runtime/reconcile.ts
  - packages/dms-automation/src/runtime/reconcileDiff.ts
  - packages/dms-automation/src/runtime/subscriptions.ts
  - packages/dms-automation/src/runtime/triggerHandles.ts
  - packages/dms-automation/src/runtime/armErrors.ts
  - packages/dms-automation/src/runtime/withTimeout.ts
  - packages/dms-automation/src/runtime/registry.ts
  - packages/dms-automation/src/runtime/builtins/triggers/manual.ts
  - packages/dms-automation/src/routes/trigger-types.ts
  - packages/dms-automation/src/stats/health.ts
  - packages/dms-automation/src/stats/health-banner.ts
docs:
  - packages/dms-automation/docs/6.faq.md
  - packages/dms-automation/docs/3.configuration.md
  - packages/dms-automation/docs/4.usage/2.procedures.md
  - packages/dms-automation/docs/4.usage/1.overview.md
  - packages/dms-automation/docs/4.usage/5.library.md
  - packages/interface-dms-automation/docs/1.index.md
---

# Triggers

How a trigger type is armed, fires and is let go, whoever registered it: the Manual trigger, a replicated and a singleton fixture trigger, one that cannot arm, one that never arms, one whose type goes away and comes back, and the cluster mode each type declares.

## Sub-features

- `a-replicated-trigger-starts-a-run-with-the-payload-it-emits`: each emit starts one run per armed procedure of its topic with the emitted JSON (string, number, null, array, emoji, nested) as the stored payload and the trigger's output.
- `a-singleton-trigger-fires-once-in-standalone-mode-and-modes-are-shown`: a singleton trigger fires on the sole instance; the cluster mode of Manual, Webhook, Schedule and the fixture triggers in the API and the Library.
- `a-trigger-that-cannot-arm-makes-its-procedure-failing-with-the-reason`: `activate` throws: Failing, `Trigger not armed:` and the message on the Procedures page and the Overview, Needs attention, cleared by pausing or replacing the trigger.
- `a-trigger-type-that-is-not-available-reads-trigger-type-id-is-not-available-and-arms-when-it-registers`: the reason `trigger type "<id>" is not available`, the handle deactivated, and a late registration arms the procedure at once.
- `a-trigger-that-never-arms-gives-up-after-ten-seconds`: `activate` gets 10 seconds; the procedure is Failing with the timeout.
- `a-trigger-is-deactivated-when-its-procedure-is-paused-deleted-or-edited`: pause, resume, new settings, an edit that leaves the trigger alone, restart and delete, and a released handle that still emits starts no run.
- `a-trigger-whose-deactivate-never-settles-is-retried-on-the-next-reconcile`: `deactivate` gets 10 seconds and the next reconcile retries.
- `the-manual-trigger-starts-a-run-only-when-asked`: Run now, the last real payload, InvokeProcedure.
- `the-starts-when-column-names-the-trigger-and-counts-the-others`: a webhook as METHOD /path (POST by default) with its type, a Manual trigger and a DMS event by their names, and `+N more` for the other triggers.

## How to get to it (user POV)

- Procedures (Status and its reason), Overview (banner, Needs attention), Library › Triggers.

## Driving it with dms-control

```bash
dms-control journey "$RUN" triggers
```

## Gotchas

- The fixture triggers are `verify.event` (replicated), `verify.leader-event` (singleton), `verify.bad-arm`, `verify.hang-arm` and `verify.hang-disarm`; `POST /verify-auto/emit` fires them and `POST /verify-auto/types/unregister|register` removes and brings back a type.
- Leadership across instances needs Redis and is not driven here; `formal-leader-triggers` covers it.
