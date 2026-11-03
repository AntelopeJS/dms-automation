---
covers:
  - packages/dms-automation/src/index.ts
  - packages/dms-automation/src/types/**
  - packages/dms-automation/src/implementations/**
  - packages/dms-automation/src/frontend-module.ts
  - packages/dms-automation/src/realtime.ts
  - packages/dms-automation/src/displays/**
  - packages/dms-automation/src/db/index.ts
  - packages/dms-automation/frontend-vue/dms.frontend.ts
  - packages/dms-automation/frontend-vue/dms.frontend.build.ts
  - packages/dms-automation/frontend-vue/build/**
  - packages/dms-automation/src/db/**
  - packages/dms-automation/src/pages/index.ts
  - packages/dms-automation/src/pages/category.ts
  - packages/dms-automation/src/runtime/builtins/index.ts
  - packages/dms-automation/src/runtime/builtins/triggers/index.ts
  - packages/dms-automation/src/runtime/executionResult.ts
  - packages/dms-automation/src/runtime/schemaProperties.ts
  - packages/dms-automation/src/runtime/serialQueue.ts
  - packages/dms-automation/src/runtime/templateCacheState.ts
  - packages/dms-automation/frontend-vue/app/utils/automation.ts
  - packages/dms-automation/frontend-vue/app/composables/useAutomationNodeKinds.ts
docs:
  - packages/dms-automation/docs/4.usage/3.builder.md
  - packages/dms-automation/docs/1.introduction.md
---

# Smoke

The fixed journey every verdict runs, whatever the diff touches: the Builder page's "A two-step procedure".

## Sub-features

- `a-manual-trigger-and-a-log-action-run-and-are-traced`: a Manual trigger joined to a Log action is imported as a disabled draft, enabled, run with `{}` as its payload; the run is `ok`, its steps are the trigger then the log, the log step received the message and the default level `info`, the message is in the run's Logs, the procedure's runs list holds the run, and the trace page names the procedure.

## How to get to it (user POV)

- Automation › Procedures › New procedure, or the Builder (`/modules/automation/builder`), then Run now; the run's trace at `/modules/automation/trace?run=<id>`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" smoke
```
