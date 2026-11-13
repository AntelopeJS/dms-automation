---
covers:
  - packages/dms-automation/src/routes/templates.ts
  - packages/dms-automation/src/db/models/automation_template.model.ts
  - packages/dms-automation/src/runtime/validateTemplate.ts
  - packages/dms-automation/src/runtime/resolveSubgraph.ts
  - packages/dms-automation/src/runtime/templateUsages.ts
  - packages/dms-automation/src/runtime/flatten.ts
  - packages/dms-automation/frontend-vue/app/components/LibraryTemplates.vue
  - packages/dms-automation/frontend-vue/app/build/utils/templates.ts
  - packages/dms-automation/frontend-vue/app/build/composables/editor/useSaveAsTemplate.ts
  - packages/dms-automation/frontend-vue/app/build/composables/editor/useForkToLocal.ts
docs:
  - packages/dms-automation/docs/4.usage/5.library.md
  - packages/dms-automation/docs/4.usage/3.builder.md
---

# Templates

Templates are groups of steps saved from the builder and placed by many procedures as linked instances. The API stores, lists, edits and deletes them; the Library's Templates tab shows them.

## Sub-features

- `a-saved-template-reads-back-exactly-in-every-view`: name, description, icon, ports and subgraph (unicode included) read back identical from create, GET one and the list; edits keep created_at.
- `template-names-are-unique-whatever-their-case`: 409 name-taken for any case, padding or accent case; own name allowed; deleted names free.
- `template-fields-have-limits-and-defaults`: name 1-200 trimmed, description 2000, icon pattern.
- `a-template-with-broken-ports-or-graph-is-refused-whole`: duplicate ports, graph errors, 20 vs 21 nested groups; nothing stored.
- `the-list-pages-newest-edit-first-and-counts-each-owner-once`: order, pages, 1000 cap, 400 for bad page values, usageCount.
- `a-template-reference-cycle-is-refused`: 400 with the cycle path.
- `usages-name-every-procedure-and-template-placing-a-template`: placements with group paths.
- `editing-a-template-changes-every-procedure-placing-it`: live effect, version bump, older runs marked.
- `deleting-a-used-template-needs-force-and-forks-every-usage`: 409 in-use, force=1/true forks, labels, nesting, counts.
- `template-routes-answer-404-for-unknown-ids-and-refuse-other-methods`: 404 texts, other methods.
- `a-procedure-placing-a-missing-template-cannot-be-enabled`: unknownTemplate problem.
- `the-library-templates-tab-lists-searches-and-edits-templates`: Templates tab rows, search, Details, Ports, Used in, Save, name-taken message.
- `deleting-a-template-from-the-library-says-how-many-places-it-forks`: confirmation text with counts, forking.
- Builder side (Save as template, Linked instance, Fork, Edit template, palette Templates group) is in `builder/a-group-saved-as-a-template-is-linked-read-only-and-forkable`.

## How to get to it (user POV)

- Builder: select a group, Save as template. Library: `/modules/automation/library?tab=templates`. API: `/api/automation/templates`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" templates
```

## Gotchas

- Journeys build templates from `journeys/parts/templates-kit.mjs` (the Greeter: Log of its `text` input, echoed on `echo`).
- The Templates tab only writes `?template=` after a template is picked; the first one is shown without it.
- Do not rely on `networkidle` in the dashboard: it keeps a live connection.
