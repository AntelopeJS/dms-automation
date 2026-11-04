---
covers:
  - packages/dms-automation/src/runtime/boundRunLog.ts
  - packages/dms-automation/src/runtime/retention.ts
  - packages/dms-automation/src/runtime/runProcedure.ts
  - packages/dms-automation/src/routes/runs.ts
  - packages/dms-automation/src/data/runs-table.ts
docs:
  - packages/dms-automation/docs/3.configuration.md
  - packages/dms-automation/docs/6.faq.md
  - packages/dms-automation/docs/4.usage/4.runs.md
---

# Redaction and retention

`runs.sensitiveNames` and the built-in credential names: what a run stores, shows and replays as `[redacted]` while the run itself gets the full values; `runs.retentionDays` and what the module deletes when it starts; the payload size limit.

## Sub-features

- `every-built-in-credential-name-is-stored-redacted-whatever-its-case`: 34 credential names and 19 near misses through headers and query, stored payload, API, trace, last payload, the ledger.
- `a-trigger-event-keeps-its-headers-and-query-redacted-like-run-now`: the same through the fixture event trigger.
- `runs-sensitive-names-add-to-the-built-in-credential-names`: `runs.sensitiveNames`, case-insensitive containing match, older runs read redacted, re-run confirmation names.
- `a-credential-a-step-copied-into-its-log-is-not-stored`: the whole value, the token after the scheme, cookie values, the 6-character minimum.
- `runs-older-than-the-retention-are-deleted-when-the-module-starts`: default 30 days, 7, 0, around the boundary.
- `a-payload-over-256-kb-is-kept-as-a-preview-and-cannot-be-re-run`: 262144 and 262145 bytes, preview, trace warning, last payload.

## How to get to it (user POV)

- Configuration (`antelope.config.ts`): `runs.retentionDays`, `runs.sensitiveNames`; the effects show in Run history and the trace.

## Driving it with dms-control

```bash
dms-control journey "$RUN" redaction-and-retention
```

## Gotchas

- `withConfig(ctx, { VERIFY_AUTO_SENSITIVE_NAMES: "a, b", VERIFY_AUTO_RETENTION_DAYS: "7" }, ...)` restarts the backend with the option.
- `a-run-log-over-2000-entries-keeps-2000-with-a-truncation-notice`: a run whose log holds exactly 2000 entries is stored whole, with no notice; one with 2001 is stored as 2000 entries, the last a warning `log truncated: 2 entries dropped`.
- Old runs are inserted in MongoDB (`parts/runs-common.mjs`), the purge runs at module start, so the journeys restart the backend and poll.
- The hourly purge and the leader-only rule need a clock of hours and a cluster: not driven.
