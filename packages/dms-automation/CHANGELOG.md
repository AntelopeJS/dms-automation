# Changelog

## v0.12.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.11.7...v0.12.0)

### 🩹 Fixes

- **release:** Install the workspace root and frontend-vue before the release lint ([#266](https://github.com/AntelopeJS/dms-automation/pull/266))
- **release:** Drop the release hook's workspace install, which the shared release workflow takes over ([#267](https://github.com/AntelopeJS/dms-automation/pull/267))

### 📦 Build

- **deps:** Require @antelopejs/dms-frontend 0.11.11 ([#264](https://github.com/AntelopeJS/dms-automation/pull/264))

### 🏡 Chore

- Bump tooling-configs to 0.10.7 and pnpm to 10.34.9 with a 24 hour release age ([#249](https://github.com/AntelopeJS/dms-automation/pull/249))
- **deps:** Update dependency vite to v8.3.8 ([#251](https://github.com/AntelopeJS/dms-automation/pull/251))
- **build:** Build and typecheck the interface by its path ([#253](https://github.com/AntelopeJS/dms-automation/pull/253))
- **deps:** Update dependency vue to v3.5.46 ([#252](https://github.com/AntelopeJS/dms-automation/pull/252))
- **deps:** Update dependency @antelopejs/dms to v0.24.2 ([#250](https://github.com/AntelopeJS/dms-automation/pull/250))
- **deps:** Pin dms 0.24.3 in the playgrounds ([#255](https://github.com/AntelopeJS/dms-automation/pull/255))
- **deps:** Update dependency @antelopejs/core to v1.24.9 ([#258](https://github.com/AntelopeJS/dms-automation/pull/258))
- **deps:** Move to @antelopejs/dms 0.25.0 and tooling-configs 0.10.13 ([#260](https://github.com/AntelopeJS/dms-automation/pull/260))
- **deps:** Move to tooling-configs 0.10.14 and sync ([#262](https://github.com/AntelopeJS/dms-automation/pull/262))
- **deps:** Pin @antelopejs/dms 0.25.2 ([#265](https://github.com/AntelopeJS/dms-automation/pull/265))
- **deps:** Pin @antelopejs/dms 0.25.3 ([#268](https://github.com/AntelopeJS/dms-automation/pull/268))

### ✅ Tests

- **e2e:** Assert the dms refusal keys in the access journeys ([#254](https://github.com/AntelopeJS/dms-automation/pull/254))

### 🤖 CI

- Bump tooling-configs to 0.10.11 and gate e2e-report through ubuntu ([#257](https://github.com/AntelopeJS/dms-automation/pull/257))

#### ⚠️ Breaking Changes

- **deps:** Require @antelopejs/dms-frontend 0.11.11 ([#264](https://github.com/AntelopeJS/dms-automation/pull/264))

### ❤️ Contributors

- Antony Rizzitelli
- dada-sudo

## v0.11.7

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.11.6...v0.11.7)

### 🏡 Chore

- **deps:** Update dependency oxlint-tsgolint to v7.0.2008 ([#245](https://github.com/AntelopeJS/dms-automation/pull/245))
- **deps:** Update dependency rimraf to v6.1.4 ([#248](https://github.com/AntelopeJS/dms-automation/pull/248))
- **deps:** Update dependency @antelopejs/core to v1.24.8 ([#247](https://github.com/AntelopeJS/dms-automation/pull/247))

### ✅ Tests

- Drop the liveHold option pins the interface-dms type now covers ([#243](https://github.com/AntelopeJS/dms-automation/pull/243))

### ❤️ Contributors

- Antony Rizzitelli

## v0.11.6

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.11.5...v0.11.6)

### 📦 Build

- **deps:** Move to @antelopejs/interface-dms 0.16 and dms 0.23 on zod 4 ([#241](https://github.com/AntelopeJS/dms-automation/pull/241))

### 🏡 Chore

- **deps:** Adopt tooling-configs 0.10 and its comment rule ([#242](https://github.com/AntelopeJS/dms-automation/pull/242))

### 🤖 CI

- Re-sync the AntelopeJS pack for the release app ([#239](https://github.com/AntelopeJS/dms-automation/pull/239))
- Stop forwarding the retired RELEASE_GITHUB_TOKEN ([#240](https://github.com/AntelopeJS/dms-automation/pull/240))

### ❤️ Contributors

- Antony Rizzitelli

## v0.11.5

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.11.4...v0.11.5)

### 🩹 Fixes

- **frontend:** Label the enum options of the builder inspector ([#233](https://github.com/AntelopeJS/dms-automation/pull/233))

### 📦 Build

- **deps:** Depend on the interface-dms 0.15 preview for the release train ([#235](https://github.com/AntelopeJS/dms-automation/pull/235))
- **deps:** Move the dms previews to the released stable versions ([#237](https://github.com/AntelopeJS/dms-automation/pull/237))

### ✅ Tests

- **e2e:** Cover the main flows in Playwright and run every journey in the merge queue ([#229](https://github.com/AntelopeJS/dms-automation/pull/229))
- **e2e:** Port the HTTP and command-line journeys to node:test integration tests ([#230](https://github.com/AntelopeJS/dms-automation/pull/230))
- **e2e:** Run the e2e kit and tests without the verify skill or dms-control ([#231](https://github.com/AntelopeJS/dms-automation/pull/231))

### ❤️ Contributors

- Antony Rizzitelli

## v0.11.4

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.11.3...v0.11.4)

### 🩹 Fixes

- Move the dms dev pins to the released 0.21 line ([#227](https://github.com/AntelopeJS/dms-automation/pull/227))

### ❤️ Contributors

- Antony Rizzitelli

## v0.11.3

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.11.2...v0.11.3)

### 🩹 Fixes

- **deps:** Name the sibling interface with workspace:^ ([#222](https://github.com/AntelopeJS/dms-automation/pull/222))
- **docs:** List the packed interface range in the README compat table ([#223](https://github.com/AntelopeJS/dms-automation/pull/223))

### ❤️ Contributors

- Antony Rizzitelli

## v0.11.2

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.11.1...v0.11.2)

### 🔥 Performance

- **automation:** Count a procedure's production runs in the query for the delete dialog ([#219](https://github.com/AntelopeJS/dms-automation/pull/219))
- **stats:** Count, group and page the runs in the database query ([#221](https://github.com/AntelopeJS/dms-automation/pull/221))

### 🩹 Fixes

- **stats:** Refuse a bare date query parameter with a 400 ([#209](https://github.com/AntelopeJS/dms-automation/pull/209))
- **runtime:** Reconcile nothing once the project announces it is stopping ([#220](https://github.com/AntelopeJS/dms-automation/pull/220))
- **deps:** Depend on the stable @antelopejs/tooling-configs

### 💅 Refactors

- **frontend:** Check dms component names with the shared assertDmsComponents ([#210](https://github.com/AntelopeJS/dms-automation/pull/210))

### 📖 Documentation

- Quote the ranges of the released interface and module versions ([#215](https://github.com/AntelopeJS/dms-automation/pull/215))

### 📦 Build

- **deps:** Move to the batch cursor drivers and the 15 November releases ([#211](https://github.com/AntelopeJS/dms-automation/pull/211))
- Move to @antelopejs/tooling-configs 0.8 and the three-tier CI ([#212](https://github.com/AntelopeJS/dms-automation/pull/212))
- **release:** Publish @antelopejs/dms-automation through the shared release hook ([#214](https://github.com/AntelopeJS/dms-automation/pull/214))

### ✅ Tests

- **automation:** Check procedure list paging over any mix of unreadable graphs ([#216](https://github.com/AntelopeJS/dms-automation/pull/216))
- **e2e:** Run the verify skill's journeys as a Playwright suite in CI ([#217](https://github.com/AntelopeJS/dms-automation/pull/217))

### ❤️ Contributors

- Antony Rizzitelli

## v0.11.1

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.11.0...v0.11.1)

### 🩹 Fixes

- **frontend:** Name the dms 0.20 components the editor, library and trace render ([#208](https://github.com/AntelopeJS/dms-automation/pull/208))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.11.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.10.0...v0.11.0)

### 🩹 Fixes

- **automation:** Read a run filter's value as text or boolean ([#203](https://github.com/AntelopeJS/dms-automation/pull/203))
- **automation:** Count only the readable procedures in the list's total and pages ([#205](https://github.com/AntelopeJS/dms-automation/pull/205))

### 💅 Refactors

- **automation:** Read string and JSON node inputs through one null-aware String ([#201](https://github.com/AntelopeJS/dms-automation/pull/201))

### 📖 Documentation

- **changelog:** Upgrade notes of dms-automation 0.10.0 ([#200](https://github.com/AntelopeJS/dms-automation/pull/200))

### 📦 Build

- **deps:** Raise interface-database-decorators to 0.3.1 in the module and playground ([#204](https://github.com/AntelopeJS/dms-automation/pull/204))
- **deps:** Move to tooling-configs 0.7.0 and compare the backend-boundary message with no separator rewrite ([#206](https://github.com/AntelopeJS/dms-automation/pull/206))
- **deps:** ⚠️  Move to interface-dms 0.14 and dms 0.20 ([#207](https://github.com/AntelopeJS/dms-automation/pull/207))

### 🏡 Chore

- **release:** @antelopejs/interface-dms-automation v0.7.0 ([2526a5c](https://github.com/AntelopeJS/dms-automation/commit/2526a5c))

### 🤖 CI

- Run the checks and tests on Windows next to Linux ([#202](https://github.com/AntelopeJS/dms-automation/pull/202))

#### ⚠️ Breaking Changes

- **deps:** ⚠️  Move to interface-dms 0.14 and dms 0.20 ([#207](https://github.com/AntelopeJS/dms-automation/pull/207))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.10.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.9.3...v0.10.0)

### Upgrade notes

- **Breaking:** three Vue components are served under new names ([#199](https://github.com/AntelopeJS/dms-automation/pull/199)). The module's own pages ask for the new names; anything else that asks for an old one gets no component.

  | Old name | New name |
  | --- | --- |
  | `dms-automation-editor` (`DmsAutomationEditor`) | `dms-automation-graph-editor` (`DmsAutomationGraphEditor`) |
  | `dms-automation-catalog` (`DmsAutomationCatalog`) | `dms-automation-library-catalog` (`DmsAutomationLibraryCatalog`) |
  | `dms-automation-templates` (`DmsAutomationTemplates`) | `dms-automation-library-templates` (`DmsAutomationLibraryTemplates`) |

- A stored graph, arm error list or template port list that is JSON but not shaped as its type is read as unreadable, like text that is not JSON ([#197](https://github.com/AntelopeJS/dms-automation/pull/197)). Such a procedure is left out of the procedures list with a warning, and `GET /api/automation/procedures/:id` refuses it with 400 `graphHasErrors` where it answered 500. A create, update, import or declaration with a node `label` that is not a string or a position that is not finite is refused with 400. No migration: every writer already stored the checked shape.
- A path given to `object.get` or `object.set`, or a refused setting value, reads as its JSON when it is a plain object, where it read as `[object Object]` ([#196](https://github.com/AntelopeJS/dms-automation/pull/196)). A list, a `Date` or a database id reads as before.
- The Vue layer's lint reads the DMS auto-import globals, so its devDependencies start at `@antelopejs/dms` `>=0.19.5` and `@antelopejs/dms-frontend` `>=0.10.4` ([#198](https://github.com/AntelopeJS/dms-automation/pull/198)). Its `engines` range is unchanged.

### 💅 Refactors

- **automation:** Fix the code behind ten lint and SAFETY suppressions ([#195](https://github.com/AntelopeJS/dms-automation/pull/195))
- **automation:** Name an object path or an enum value by its JSON text ([#196](https://github.com/AntelopeJS/dms-automation/pull/196))
- **automation:** Check the shape of a stored graph, arm error or port on read ([#197](https://github.com/AntelopeJS/dms-automation/pull/197))
- **automation:** Lint the Vue layer with no-undef on, reading the DMS auto-import globals ([#198](https://github.com/AntelopeJS/dms-automation/pull/198))
- **frontend:** ⚠️  Rename Editor, Catalog and Templates to GraphEditor, LibraryCatalog and LibraryTemplates ([#199](https://github.com/AntelopeJS/dms-automation/pull/199))

#### ⚠️ Breaking Changes

- **frontend:** ⚠️  Rename Editor, Catalog and Templates to GraphEditor, LibraryCatalog and LibraryTemplates ([#199](https://github.com/AntelopeJS/dms-automation/pull/199))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.9.3

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.9.2...v0.9.3)

### 🔥 Performance

- **runtime:** Queue no reconcile once the module stops ([#190](https://github.com/AntelopeJS/dms-automation/pull/190))
- **stats:** Share one runs read between the stats answers asked together ([#191](https://github.com/AntelopeJS/dms-automation/pull/191))
- **ci:** Key the TLC cache on the model so main replays its checked result ([#193](https://github.com/AntelopeJS/dms-automation/pull/193))

### 🩹 Fixes

- **release:** Regenerate the module README table when the interface bumps ([#194](https://github.com/AntelopeJS/dms-automation/pull/194))

### 📦 Build

- **deps:** Bump @antelopejs/tooling-configs to 0.5.0 ([#189](https://github.com/AntelopeJS/dms-automation/pull/189))
- **deps:** Bump @antelopejs/tooling-configs to 0.5.1 ([#192](https://github.com/AntelopeJS/dms-automation/pull/192))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.9.2

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.9.1...v0.9.2)

### 🔥 Performance

- **verify:** Plan the diff against origin/main ([#170](https://github.com/AntelopeJS/dms-automation/pull/170))
- **verify:** Open a page once its app is mounted ([#171](https://github.com/AntelopeJS/dms-automation/pull/171))

### 🩹 Fixes

- **stats:** Count procedures, not trigger nodes, in By trigger ([#180](https://github.com/AntelopeJS/dms-automation/pull/180))
- **runs:** Answer an empty scope banner for a valueless ?procedure= ([#182](https://github.com/AntelopeJS/dms-automation/pull/182))
- **run-procedure:** Default to the last payload of the trigger the run starts from ([#175](https://github.com/AntelopeJS/dms-automation/pull/175))
- **pages:** Offer the year comparison when runs are kept long enough ([#172](https://github.com/AntelopeJS/dms-automation/pull/172))
- **runtime:** Recompute a data node wired from a loop's value on each iteration ([#177](https://github.com/AntelopeJS/dms-automation/pull/177))
- **dms-automation:** Refuse a run-now graph with no trigger or a missing setting ([#181](https://github.com/AntelopeJS/dms-automation/pull/181))
- **leader:** Keep a stopped instance from leading or re-arming its singletons ([#173](https://github.com/AntelopeJS/dms-automation/pull/173))
- **dms-automation:** Release the leader key only after the singleton triggers are torn down ([#176](https://github.com/AntelopeJS/dms-automation/pull/176))
- **leader:** Fire singleton triggers only within the leader lease ([#174](https://github.com/AntelopeJS/dms-automation/pull/174))
- **procedures:** Follow the list's changes on screen while Live ([#183](https://github.com/AntelopeJS/dms-automation/pull/183))
- **runs:** Bring new runs into the Run history while Live ([#184](https://github.com/AntelopeJS/dms-automation/pull/184))
- **frontend:** Key run states, problems, durations and usage by own ids ([#188](https://github.com/AntelopeJS/dms-automation/pull/188))

### 📖 Documentation

- **interface:** Say the calls wait for an implementation in the interface skill ([#178](https://github.com/AntelopeJS/dms-automation/pull/178))
- **readme:** Open with the AntelopeJS DMS module kit ([#187](https://github.com/AntelopeJS/dms-automation/pull/187))

### 📦 Build

- **deps:** Bump @antelopejs/tooling-configs to 0.4.0 ([#185](https://github.com/AntelopeJS/dms-automation/pull/185))
- **deps:** Bump @antelopejs/dms to 0.18.2 and drop verify publish ([#186](https://github.com/AntelopeJS/dms-automation/pull/186))

### 🏡 Chore

- **release:** @antelopejs/interface-dms-automation v0.6.2 ([b970321](https://github.com/AntelopeJS/dms-automation/commit/b970321))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.9.1

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.9.0...v0.9.1)

### 🩹 Fixes

- **procedures:** Serve the tab counters on GET count/batch ([#165](https://github.com/AntelopeJS/dms-automation/pull/165))
- **skills:** Split trigger cluster questions between dms-automation and its interface ([#167](https://github.com/AntelopeJS/dms-automation/pull/167))

### 📦 Build

- **deps:** Bump @antelopejs packages to the 2026-11-06 releases ([#169](https://github.com/AntelopeJS/dms-automation/pull/169))

### 🏡 Chore

- Remove the .amp directory ([#162](https://github.com/AntelopeJS/dms-automation/pull/162))
- **verify:** Remove seeded runs from the verification skill ([#163](https://github.com/AntelopeJS/dms-automation/pull/163))
- **verify:** Load the published api 2.x instead of patching 1.6.0 ([#164](https://github.com/AntelopeJS/dms-automation/pull/164))
- **ci:** Remove the weekly mutation caller ([#166](https://github.com/AntelopeJS/dms-automation/pull/166))
- **release:** @antelopejs/interface-dms-automation v0.6.1 ([1c890de](https://github.com/AntelopeJS/dms-automation/commit/1c890de))

### 🤖 CI

- Call ci-node.yml@v1 ([#168](https://github.com/AntelopeJS/dms-automation/pull/168))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.9.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.8.0...v0.9.0)

### 📖 Documentation

- **github:** Send questions and ideas to Discord ([#134](https://github.com/AntelopeJS/dms-automation/pull/134))

### 🏡 Chore

- Land the cleanup campaign on main ([#158](https://github.com/AntelopeJS/dms-automation/pull/158))
- **release:** @antelopejs/interface-dms-automation v0.6.0 ([6e5cfbf](https://github.com/AntelopeJS/dms-automation/commit/6e5cfbf))
- Land the cleanup campaign on main ([#161](https://github.com/AntelopeJS/dms-automation/pull/161))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.8.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.7.0...v0.8.0)

### 🚀 Enhancements

- **frontend:** Enforce the backend boundary in production builds ([#93](https://github.com/AntelopeJS/dms-automation/pull/93))

### 🩹 Fixes

- **frontend:** Present API failures once ([#128](https://github.com/AntelopeJS/dms-automation/pull/128))

### 💅 Refactors

- Move comments into TSDoc or delete them ([#85](https://github.com/AntelopeJS/dms-automation/pull/85))
- Replace assertions, typeof checks and unknown types with guards and domain types ([#91](https://github.com/AntelopeJS/dms-automation/pull/91))
- Split the oversize files along their seams ([#92](https://github.com/AntelopeJS/dms-automation/pull/92))
- **amp:** Narrow the forwarded location header with a JSDoc type guard ([#94](https://github.com/AntelopeJS/dms-automation/pull/94))
- Clear the residual ratchet findings ([#96](https://github.com/AntelopeJS/dms-automation/pull/96))

### 📖 Documentation

- **changelog:** Upgrade notes of dms-automation 0.7.0 ([#78](https://github.com/AntelopeJS/dms-automation/pull/78))
- **readme:** Link the DMS and fix the renderer range ([#119](https://github.com/AntelopeJS/dms-automation/pull/119))
- **readme:** Use one Discord invite ([#117](https://github.com/AntelopeJS/dms-automation/pull/117))
- Name DMS 0.11 and renderer 0.9, and ignore the playground's frontend build ([#79](https://github.com/AntelopeJS/dms-automation/pull/79))

### 📦 Build

- Adopt the AntelopeJS guardrail pack ([#80](https://github.com/AntelopeJS/dms-automation/pull/80))
- Upgrade the guardrail pack to 0.2.11 ([#83](https://github.com/AntelopeJS/dms-automation/pull/83))
- **deps:** Bump @antelopejs/tooling-configs to 0.2.17 ([#95](https://github.com/AntelopeJS/dms-automation/pull/95))

### 🏡 Chore

- Configure Renovate with the shared preset ([#81](https://github.com/AntelopeJS/dms-automation/pull/81))

### ✅ Tests

- **skills:** Add eval cases for the dms-automation skills ([#82](https://github.com/AntelopeJS/dms-automation/pull/82))
- Move the source-text invariants to lint rules and the loaders to helpers ([#84](https://github.com/AntelopeJS/dms-automation/pull/84))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.7.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.6.0...v0.7.0)

### Upgrade notes

- Implements `@antelopejs/interface-dms-automation` `>=0.5.0 <0.6.0` (see its 0.5.0 notes) and runs on `@antelopejs/dms` `>=0.11.0`, `@antelopejs/interface-dms` `>=0.9.0` and `@antelopejs/dms-frontend` `>=0.9.0 <0.10.0` ([#74](https://github.com/AntelopeJS/dms-automation/pull/74)).
- **Breaking:** a module gone mid-run fails the run like any other error ([#71](https://github.com/AntelopeJS/dms-automation/pull/71)). The `cancelled` status is removed from runs, filters, health figures and the builder. No migration: a run already stored as `cancelled` matches no status filter.
- **Breaking:** `DeclareProcedure` writes a declared procedure once ([#73](https://github.com/AntelopeJS/dms-automation/pull/73)). A later declaration answers `kept` and leaves the stored procedure as it is (its users own it from then on); a deleted procedure is created again. The `declaredHash` field is removed. If arming fails after the insert, the triggers arm at the next start.
- A procedure declared twice at the same moment (two instances starting together) is created by one call and `kept` by the other, through the database's `DuplicateKeyError` ([#75](https://github.com/AntelopeJS/dms-automation/pull/75)). Requires `@antelopejs/interface-database` `>=0.1.11` and a driver that throws it (`@antelopejs/mongodb` ≥ 1.5.0, `@antelopejs/postgres` ≥ 0.2.2).
- The in-memory tests of `DeclareProcedure` restore their fakes without unbound methods ([#77](https://github.com/AntelopeJS/dms-automation/pull/77)).
- The procedure picker answers `?ids=`, so a picked procedure is named ([#72](https://github.com/AntelopeJS/dms-automation/pull/72)).

### 🩹 Fixes

- **runs:** The procedure picker answers ?ids=, so a picked procedure is named ([#72](https://github.com/AntelopeJS/dms-automation/pull/72))
- **declare:** A procedure declared twice at the same moment is kept ([#75](https://github.com/AntelopeJS/dms-automation/pull/75))

### 💅 Refactors

- **runtime:** ⚠️  A module gone mid-run fails the run like any other error ([#71](https://github.com/AntelopeJS/dms-automation/pull/71))
- ⚠️  Write declared procedures once ([#73](https://github.com/AntelopeJS/dms-automation/pull/73))

### 📖 Documentation

- **changelog:** Upgrade notes of dms-automation 0.6.0 ([#70](https://github.com/AntelopeJS/dms-automation/pull/70))
- **changelog:** Upgrade notes of interface-dms-automation 0.5.0 ([#76](https://github.com/AntelopeJS/dms-automation/pull/76))

### 📦 Build

- **deps:** Run on dms 0.11, dms-frontend 0.9 and implement interface-dms-automation 0.5 ([#74](https://github.com/AntelopeJS/dms-automation/pull/74))

### 🏡 Chore

- **release:** @antelopejs/interface-dms-automation v0.5.0 ([5a21f51](https://github.com/AntelopeJS/dms-automation/commit/5a21f51))

### ✅ Tests

- **declare:** Restore the in-memory fakes without unbound methods ([#77](https://github.com/AntelopeJS/dms-automation/pull/77))

#### ⚠️ Breaking Changes

- **runtime:** ⚠️  A module gone mid-run fails the run like any other error ([#71](https://github.com/AntelopeJS/dms-automation/pull/71))
- ⚠️  Write declared procedures once ([#73](https://github.com/AntelopeJS/dms-automation/pull/73))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.6.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.5.1...v0.6.0)

### Upgrade notes

- Runs on `@antelopejs/dms` 0.10 (`@antelopejs/interface-dms >=0.8.0`) and implements `@antelopejs/interface-dms-automation` 0.4.
- Block and permission ids: on the Overview and the Run history, the period selector moved into the page toolbar, from `<page>.period` to `<page>.live.period` (`live`, `live.toggle` and `live.topics` are unchanged). A custom role that granted `period` must be granted `live.period` again ([#60](https://github.com/AntelopeJS/dms-automation/pull/60)).
- `POST /api/automation/procedures/:id/test` answers `409` with the draft's `realEffects` while a step would act for real; call it again with `confirmRealEffects: true` to run it. `POST /api/automation/procedures/:id/test-effects` lists those steps ([#58](https://github.com/AntelopeJS/dms-automation/pull/58)).
- i18n keys removed: `dms_automation.kpi.vsPrevious` and `dms_automation.overview.runsPerDayLegend` (the comparison is the DMS's, [#64](https://github.com/AntelopeJS/dms-automation/pull/64), split from #60). A project that overrides them can drop its overrides.

### 🚀 Enhancements

- **frontend:** The frontend registration as a pure function, declared as dmsFrontend ([#67](https://github.com/AntelopeJS/dms-automation/pull/67))
- **pages:** Adopt the DMS page toolbar on the overview, run history and procedures ([#60](https://github.com/AntelopeJS/dms-automation/pull/60))
- **pages:** Offer a comparison menu on the overview and run history ([#64](https://github.com/AntelopeJS/dms-automation/pull/64))
- **runs:** Open the run preview in a right drawer instead of the side panel ([#63](https://github.com/AntelopeJS/dms-automation/pull/63))

### 🩹 Fixes

- **builder:** Label node ports with their field's translated title ([#59](https://github.com/AntelopeJS/dms-automation/pull/59))
- **frontend:** Fill the id of server-worded confirm dialogs ([#61](https://github.com/AntelopeJS/dms-automation/pull/61))
- **builder:** Confirm real effects before a test run and let actions dry-run ([#58](https://github.com/AntelopeJS/dms-automation/pull/58))
- **overview:** Size each block's skeleton as what it loads ([#65](https://github.com/AntelopeJS/dms-automation/pull/65))

### 📦 Build

- Implement interface-dms-automation 0.4 ([#68](https://github.com/AntelopeJS/dms-automation/pull/68))
- Run on @antelopejs/dms 0.10 and @antelopejs/dms-frontend 0.8 ([#69](https://github.com/AntelopeJS/dms-automation/pull/69))

### 🏡 Chore

- **release:** @antelopejs/interface-dms-automation v0.4.0 ([2611d5d](https://github.com/AntelopeJS/dms-automation/commit/2611d5d))

### ❤️ Contributors

- Maxime Westhoven <maxime@altab.be>
- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.5.1

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.5.0...v0.5.1)

### 🩹 Fixes

- **frontend:** Run on @antelopejs/dms-frontend 0.7 ([#62](https://github.com/AntelopeJS/dms-automation/pull/62))

### 📖 Documentation

- Clarify learning paths and illustrate real outcomes ([#57](https://github.com/AntelopeJS/dms-automation/pull/57))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.5.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.4.1...v0.5.0)

### 🚀 Enhancements

- Declare and run procedures from code, and survive module reloads ([#56](https://github.com/AntelopeJS/dms-automation/pull/56))

### 📦 Build

- Install frontend development dependencies from the root ([#54](https://github.com/AntelopeJS/dms-automation/pull/54))

### 🏡 Chore

- **release:** @antelopejs/interface-dms-automation v0.3.0 ([3246f7d](https://github.com/AntelopeJS/dms-automation/commit/3246f7d))

### ❤️ Contributors

- Maxime Westhoven ([@mwesto](http://github.com/mwesto))
- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.4.1

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.4.0...v0.4.1)

### 💅 Refactors

- **frontend:** Declare the builder's test payload read with the dock's reads ([#50](https://github.com/AntelopeJS/dms-automation/pull/50))

### 📖 Documentation

- Add user guide and module skill ([#46](https://github.com/AntelopeJS/dms-automation/pull/46))
- Establish the automation consumer reference ([#51](https://github.com/AntelopeJS/dms-automation/pull/51))
- Make dense guide sections easier to scan ([#52](https://github.com/AntelopeJS/dms-automation/pull/52))

### 🏡 Chore

- **interface:** Raise verified foundation dependency floors ([#53](https://github.com/AntelopeJS/dms-automation/pull/53))
- **release:** @antelopejs/interface-dms-automation v0.2.1 ([4da6c69](https://github.com/AntelopeJS/dms-automation/commit/4da6c69))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.4.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.3.1...v0.4.0)

### 🚀 Enhancements

- ⚠️  Migrate to DMS 0.9 and renderer 0.6 ([#49](https://github.com/AntelopeJS/dms-automation/pull/49))

#### ⚠️ Breaking Changes

- ⚠️  Migrate to DMS 0.9 and renderer 0.6 ([#49](https://github.com/AntelopeJS/dms-automation/pull/49))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.3.1

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.3.0...v0.3.1)

### 🩹 Fixes

- **pages:** Name row fields with {{row.X}} tokens for dms 0.8 ([#45](https://github.com/AntelopeJS/dms-automation/pull/45))

### ✅ Tests

- **runs:** Expect the table display before the grouped one ([#43](https://github.com/AntelopeJS/dms-automation/pull/43))

### 🤖 CI

- Speed up pipeline ([#44](https://github.com/AntelopeJS/dms-automation/pull/44))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.3.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.2.7...v0.3.0)

### 🚀 Enhancements

- **dms-automation:** ⚠️  Port the v2 design on dms 0.7 ([#39](https://github.com/AntelopeJS/dms-automation/pull/39))

### 💅 Refactors

- **runs:** Namespace the timeline display id as automation:timeline ([#38](https://github.com/AntelopeJS/dms-automation/pull/38))

### 🏡 Chore

- **release:** @antelopejs/interface-dms-automation v0.2.0 ([146bc84](https://github.com/AntelopeJS/dms-automation/commit/146bc84))

#### ⚠️ Breaking Changes

- **dms-automation:** ⚠️  Port the v2 design on dms 0.7 ([#39](https://github.com/AntelopeJS/dms-automation/pull/39))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.7

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.2.6...v0.2.7)

### 🚀 Enhancements

- **frontend-vue:** Resolve i18n keys in automation type names ([#37](https://github.com/AntelopeJS/dms-automation/pull/37))

### 🏡 Chore

- **playground:** Run api ^1.3.1 and open module source ranges ([#35](https://github.com/AntelopeJS/dms-automation/pull/35))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.6

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.2.5...v0.2.6)

### 🚀 Enhancements

- **frontend-vue:** Declare the @antelopejs/dms-frontend releases the layer supports ([#31](https://github.com/AntelopeJS/dms-automation/pull/31))

### ❤️ Contributors

- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.2.5

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.2.4...v0.2.5)

### 💅 Refactors

- **pages:** Let the library and the builder fill the panel ([#34](https://github.com/AntelopeJS/dms-automation/pull/34))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.4

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.2.3...v0.2.4)

### 🩹 Fixes

- **deps:** Cap @antelopejs/interface-dms-automation below the next minor and check interface ranges ([#33](https://github.com/AntelopeJS/dms-automation/pull/33))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.3

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.2.2...v0.2.3)

### 🩹 Fixes

- **deps:** Accept compatible 0.x versions of the interface packages ([#28](https://github.com/AntelopeJS/dms-automation/pull/28))

### ❤️ Contributors

- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.2.2

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.2.1...v0.2.2)

### 🩹 Fixes

- **deps:** Relax @antelopejs/interface-database to >=0.1.7 <1.0.0 ([#30](https://github.com/AntelopeJS/dms-automation/pull/30))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.1

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.2.0...v0.2.1)

### 🔥 Performance

- **db:** Index procedure run history and bound persisted run logs ([#29](https://github.com/AntelopeJS/dms-automation/pull/29))

### 🏡 Chore

- **release:** @antelopejs/interface-dms-automation v0.1.1 ([4cc3652](https://github.com/AntelopeJS/dms-automation/commit/4cc3652))
- **playground:** Move to @antelopejs/dms-frontend 0.3.2 ([#27](https://github.com/AntelopeJS/dms-automation/pull/27))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.2.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.1.5...v0.2.0)

### 🩹 Fixes

- **deps:** Accept @antelopejs/interface-api 0.0.14 and later 0.x ([#25](https://github.com/AntelopeJS/dms-automation/pull/25))

### 💅 Refactors

- **build:** Merge tsconfig.build.json into tsconfig.json ([#20](https://github.com/AntelopeJS/dms-automation/pull/20))
- **package:** ⚠️  Drop moduleResolution node support and pack-based checks ([#23](https://github.com/AntelopeJS/dms-automation/pull/23))

### 🏡 Chore

- **agents:** Install Node 24 in setup script ([#18](https://github.com/AntelopeJS/dms-automation/pull/18))
- **release:** @antelopejs/interface-dms-automation v0.1.0 ([e0e09c6](https://github.com/AntelopeJS/dms-automation/commit/e0e09c6))

### 🤖 CI

- **release:** Release next from a dedicated branch and restore requireCommits ([#21](https://github.com/AntelopeJS/dms-automation/pull/21))
- **release:** Reference the shared release workflows through v1 ([#22](https://github.com/AntelopeJS/dms-automation/pull/22))

#### ⚠️ Breaking Changes

- **package:** ⚠️  Drop moduleResolution node support and pack-based checks ([#23](https://github.com/AntelopeJS/dms-automation/pull/23))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.5

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.1.4...v0.1.5)

### 🩹 Fixes

- Route playground through public gateway ([#16](https://github.com/AntelopeJS/dms-automation/pull/16))
- **automation:** Read type-origin from the proxy's state registry ([#17](https://github.com/AntelopeJS/dms-automation/pull/17))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.4

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.1.3...v0.1.4)

### 🩹 Fixes

- **automation:** Route procedure pages through builder ([#14](https://github.com/AntelopeJS/dms-automation/pull/14))

### 🏡 Chore

- **playground:** Use dms frontend 0.2.1 ([#15](https://github.com/AntelopeJS/dms-automation/pull/15))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.3

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.1.2...v0.1.3)

### 🩹 Fixes

- Update DMS playground CLI ([#11](https://github.com/AntelopeJS/dms-automation/pull/11))
- Use DmsClientOnly in automation editor ([#13](https://github.com/AntelopeJS/dms-automation/pull/13))

### 🏡 Chore

- Add orb setup for DMS playground ([#12](https://github.com/AntelopeJS/dms-automation/pull/12))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.2

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.1.1...v0.1.2)

### 💅 Refactors

- **frontend:** Import the SDK through #dms/frontend-module ([#10](https://github.com/AntelopeJS/dms-automation/pull/10))

### 🏡 Chore

- Require @antelopejs/core 1.7 ([#8](https://github.com/AntelopeJS/dms-automation/pull/8))
- Align community files with the organization defaults ([#9](https://github.com/AntelopeJS/dms-automation/pull/9))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.1

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.1.0...v0.1.1)

## v0.1.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.0.2...v0.1.0)

### 🩹 Fixes

- **release:** ⚠️  Publish with pnpm and depend on the interface by range ([#4](https://github.com/AntelopeJS/dms-automation/pull/4))
- **frontend:** ⚠️  Register the frontend module under its package name ([#5](https://github.com/AntelopeJS/dms-automation/pull/5))

#### ⚠️ Breaking Changes

- **release:** ⚠️  Publish with pnpm and depend on the interface by range ([#4](https://github.com/AntelopeJS/dms-automation/pull/4))
- **frontend:** ⚠️  Register the frontend module under its package name ([#5](https://github.com/AntelopeJS/dms-automation/pull/5))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.2

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/interface-v0.0.2...v0.0.2)

### 🏡 Chore

- **release:** Build the interface package before releasing the runtime ([#3](https://github.com/AntelopeJS/dms-automation/pull/3))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

