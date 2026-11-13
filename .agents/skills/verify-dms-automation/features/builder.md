---
covers:
  - packages/dms-automation/frontend-vue/app/components/GraphEditor.vue
  - packages/dms-automation/frontend-vue/app/components/Editor/**
  - packages/dms-automation/frontend-vue/app/build/**
  - packages/dms-automation/frontend-vue/app/composables/useGraphConnect.ts
  - packages/dms-automation/src/pages/builder.ts
  - packages/dms-automation/frontend-vue/app/components/IconPicker.vue
docs:
  - packages/dms-automation/docs/4.usage/3.builder.md
---

# Builder

The graph editor: bar, palette, canvas, inspector and dock, with test runs, Run now, Export JSON, groups and templates.

## Sub-features

- `the-bar-holds-the-documented-controls-and-their-states`: bar controls in order, More actions menu, Hide/Show blocks remembered, unsaved counts, Discard, empty name, Save.
- `ctrl-s-saves-ctrl-enter-tests-and-ctrl-p-switches-procedures`: shortcuts, switcher, macOS key labels.
- `the-palette-groups-blocks-by-module-and-category-and-searches-them`: groups, counts, sections, search, Off marker, Templates group.
- `a-clicked-block-is-added-after-the-selected-step`: placement and saved chain.
- `an-enabled-procedure-with-problems-is-saved-as-a-draft`: Problems tab, Select node, refused save, Save as draft.
- `the-dock-offers-recent-runs-the-test-payload-and-the-test-run`: dock tabs, prefilled payload, invalid JSON, step list.
- `a-test-that-would-act-for-real-asks-first-and-runs-nothing-if-cancelled`: Test with real effects? dialog.
- `run-now-runs-the-saved-version-and-asks-about-unsaved-changes`: Run now dialog and the unsaved question.
- `export-json-downloads-the-procedure-and-import-recreates-it`: download content and re-import.
- `selected-steps-fold-into-a-group-with-ports-that-keeps-the-procedure-running`: Group (N), Group ports, Enter group.
- `a-group-saved-as-a-template-is-linked-read-only-and-forkable`: Save as template, Linked, Fork, Edit template, palette template.
- `the-inspector-names-the-step-and-shows-its-settings-docs-and-last-run`: Step name, Settings, Docs, Next run, Last run.
- `a-draft-says-nothing-fires-until-it-is-enabled-and-offers-to-enable-it`: draft/paused banner, empty and missing procedure notices.
- `wires-are-drawn-between-matching-ports-replaced-and-unwired`: port colours, mismatch, replace, Unwire, loop refusal.
- `wrap-in-retry-puts-a-step-inside-a-retry`: Wrap in Retry.

## How to get to it (user POV)

- `/modules/automation/builder?selected=<procedureId>` (or `?template=<id>`).
- `saving-over-a-change-made-elsewhere-asks-keep-editing-reload-or-overwrite`: saving over a version saved elsewhere opens a dialog titled “<name> was changed elsewhere” with Keep editing (nothing stored), Reload saved version (the other version is brought in) and Overwrite with mine (this tab's graph is stored).

## Driving it with dms-control

```bash
dms-control journey "$RUN" builder
```

## Gotchas

- The page hydrates after load: `openBuilder` flips the palette toggle until it reacts.
- Nodes must not overlap and the inspector covers the right of the canvas: `spread` lays nodes out and `selectNode` presses Fit view first. Ctrl-click multi-selects.
- Links are drawn with real mouse drags between `.vue-flow__handle` elements (`connect`).
- The Run now payload is a code editor, read it with `innerText`; kbd hints are upper-cased by CSS (`CTRL`).
- Test steps run with `ctx.dryRun` true for every action, simulated or not.
