---
covers:
  - packages/dms-automation/src/routes/library.ts
  - packages/dms-automation/src/routes/trigger-types.ts
  - packages/dms-automation/src/routes/action-types.ts
  - packages/dms-automation/src/routes/data-node-types.ts
  - packages/dms-automation/src/routes/node-kinds.ts
  - packages/dms-automation/src/routes/typeConfigShared.ts
  - packages/dms-automation/src/runtime/typeSwitches.ts
  - packages/dms-automation/src/runtime/typeOrigin.ts
  - packages/dms-automation/src/pages/library.ts
  - packages/dms-automation/frontend-vue/app/components/LibraryCatalog.vue
  - packages/dms-automation/frontend-vue/app/components/Catalog/**
  - packages/dms-automation/frontend-vue/app/components/WebhookEndpoint.vue
docs:
  - packages/dms-automation/docs/4.usage/5.library.md
  - packages/dms-automation/docs/1.introduction.md
---

# Library

The Library page (`/modules/automation/library`): the five tabs with their counts, entries grouped by module and category, search, the entry detail cards, Used by, the Enabled switch of triggers and actions with its confirmation, and the webhook URL of each use.

## Sub-features

- `the-tabs-carry-the-counts-of-what-is-registered-and-the-link-keeps-the-open-tab`: The Library has the tabs Triggers, Actions, Data nodes, Templates and Flow & helpers with their counts (the registered types, the saved templates, the nine flow and helper blocks), and the link keeps the open tab.
- `entries-are-grouped-by-module-built-ins-first-and-data-nodes-by-category`: Entries are grouped by the module that registered them, built-ins first; data nodes are also grouped by category, and flow blocks into Flow and Helpers.
- `search-filters-the-entries-by-id-name-description-and-module`: Search… filters the entries of the open tab, case-insensitively, by name, description, id and module; with nothing found the list says Nothing matches. and the detail moves to the first entry left.
- `an-entry-shows-its-name-description-id-group-settings-inputs-and-outputs`: Selecting a trigger, an action, a data node or a flow block shows its name, description and id, the group it is listed under, Settings on each node (trigger, data node), Inputs (action, data node, flow block) and Outputs.
- `a-trigger-shows-its-cluster-mode-after-its-id-and-in-a-banner`: A trigger shows its cluster mode after its id and in a banner: Replicated across instances (replicated), where every instance listens and one of them handles each call, or Runs on one instance (singleton), where only the leader runs it; actions and data nodes show none.
- `used-by-lists-the-procedures-with-their-state-where-the-node-sits-and-open`: Used by lists the procedures that use an entry, each with its state, where the node sits (in a group or through a template) and Open to open it in the builder; the list shows how many procedures use it, and an unused entry says so.
- `a-webhook-use-shows-its-full-url-built-on-the-api-base-url`: A webhook trigger shows the full URL of each use under Used by, built on the DMS apiBaseUrl (trailing slash dropped); a loopback or empty apiBaseUrl is reported as not configured.
- `disabling-a-type-asks-first-and-says-how-many-enabled-procedures-it-stops`: Triggers and actions have an Enabled switch that turns the type off for the whole project; when enabled procedures use the type, Used by says how many of them disabling it stops (a procedure counts once, a disabled one not at all) and Disable asks for confirmation; a type no enabled procedure uses switches off without asking.
- `steps-of-a-disabled-type-fail-and-a-disabled-trigger-is-not-armed`: Steps of a disabled action type fail when they run, and a disabled trigger type is not armed; both work again once enabled.
- `flow-blocks-data-nodes-and-unknown-types-cannot-be-switched-off`: Flow and helper blocks are built into the builder and cannot be switched off (no switch, and it says so); data nodes have no switch either; the switch routes refuse a type no module registered and a body without enabled.

## How to get to it (user POV)

- Sign in as the platform owner, open Automation › Library (`/modules/automation/library?tab=triggers&item=webhook`).
- The tabs read `GET /api/automation/library/counts` and the lists `trigger-types`, `action-types`, `data-node-types`, `node-kinds`; Used by reads `GET /library/usage/{triggers,actions,dataNodes,flow}`; the switch is `PUT /action-types/:id/config` and `PUT /trigger-types/:id/config`.
- `?tab=` keeps the open tab and `?item=` the selected entry.

## Driving it with dms-control

```bash
dms-control journey "$RUN" library
```

- Fixtures: `verify.*` types of the playground give a module group (`app`), a singleton trigger and data nodes with settings.
- `journeys/parts/library-kit.mjs` builds a procedure with a local group and a template instance (`procedureWithGroups`) to prove the `in group` and `via template` lines.
- `withConfig` with `VERIFY_AUTO_API_BASE_URL` (`empty`, a URL) shows the webhook base.

## Gotchas

- Page text is upper case where the page styles it (`USED BY 4`, `SETTINGS ON EACH NODE`); the list headings are read from the DOM.
- The webhook URL in a list line is the compact one: the unconfigured-address hint shows only in the builder's inspector.
- The Templates tab is driven for its count only; its detail belongs to `templates`.
