---
covers:
  - packages/dms-automation/src/pages/procedures.ts
  - packages/dms-automation/src/data/procedures-table.ts
  - packages/dms-automation/frontend-vue/app/build/composables/editor/useProcedureActions.ts
  - packages/dms-automation/frontend-vue/i18n/locales/dms-automation-en-GB.json
  - packages/dms-automation/frontend-vue/app/plugins/cell-displays.ts
  - packages/dms-automation/frontend-vue/app/utils/describe.ts
docs:
  - packages/dms-automation/docs/4.usage/2.procedures.md
---

# Procedures page

`/modules/automation/procedures` in the browser: the list, states, tabs, columns, row menu, dialogs and live mode.

## Sub-features

- `the-list-shows-five-columns-with-each-state-and-its-reason`: the seven-row table in state order, Starts when wording, marks opening traces.
- `tabs-filter-by-state-and-show-their-counts`: tab counts (FAILS: issue draft dms-automation-procedures-tab-counts-never-load), tab contents, search, Trigger type filter.
- `the-column-picker-adds-description-last-error-enabled-trigger-type-and-avg`.
- `the-row-menu-offers-the-documented-actions-for-each-state`.
- `row-actions-pause-resume-duplicate-run-now-and-the-links-do-what-the-docs-say`.
- `delete-asks-first-and-an-enabled-procedure-by-typing-its-name`.
- `new-procedure-dialog-creates-a-disabled-draft-and-opens-the-builder`, `import-json-dialog-creates-a-draft-or-says-why-not`.
- `live-and-pause-hold-the-rows-and-count-the-changes` (FAILS: issue draft dms-automation-procedures-live-list-does-not-take-new-procedures).
- `an-empty-list-offers-the-first-procedure`.

## How to get to it (user POV)

- Modules, Automation, Procedures; sign in as the owner.

## Driving it with dms-control

```bash
dms-control journey "$RUN" procedures-page
```

## Gotchas

- Pages hydrate after load: helpers in `journeys/parts/procedures-page-ui.mjs` click again until the menu or dialog shows.
- `seedStates` in `procedures-page-seed.mjs` builds one procedure per state.
- Dialog texts end with "ESC to cancel"; the delete button is not disabled, a wrong typed name simply deletes nothing.
