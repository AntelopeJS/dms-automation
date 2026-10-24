# Changelog

## v0.7.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/v0.6.0...v0.7.0)

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

