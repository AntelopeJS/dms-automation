# Changelog

## v0.5.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/interface-v0.4.0...v0.5.0)

### 🚀 Enhancements

- **pages:** Adopt the DMS page toolbar on the overview, run history and procedures ([#60](https://github.com/AntelopeJS/dms-automation/pull/60))
- **pages:** Offer a comparison menu on the overview and run history ([#64](https://github.com/AntelopeJS/dms-automation/pull/64))
- **runs:** Open the run preview in a right drawer instead of the side panel ([#63](https://github.com/AntelopeJS/dms-automation/pull/63))

### 🩹 Fixes

- **overview:** Size each block's skeleton as what it loads ([#65](https://github.com/AntelopeJS/dms-automation/pull/65))
- **runs:** The procedure picker answers ?ids=, so a picked procedure is named ([#72](https://github.com/AntelopeJS/dms-automation/pull/72))

### 💅 Refactors

- **runtime:** ⚠️  A module gone mid-run fails the run like any other error ([#71](https://github.com/AntelopeJS/dms-automation/pull/71))
- ⚠️  Write declared procedures once ([#73](https://github.com/AntelopeJS/dms-automation/pull/73))

### 📖 Documentation

- **changelog:** Upgrade notes of dms-automation 0.6.0 ([#70](https://github.com/AntelopeJS/dms-automation/pull/70))

### 📦 Build

- Implement interface-dms-automation 0.4 ([#68](https://github.com/AntelopeJS/dms-automation/pull/68))
- Run on @antelopejs/dms 0.10 and @antelopejs/dms-frontend 0.8 ([#69](https://github.com/AntelopeJS/dms-automation/pull/69))

### 🏡 Chore

- **release:** @antelopejs/dms-automation v0.6.0 ([90d3ae8](https://github.com/AntelopeJS/dms-automation/commit/90d3ae8))

#### ⚠️ Breaking Changes

- **runtime:** ⚠️  A module gone mid-run fails the run like any other error ([#71](https://github.com/AntelopeJS/dms-automation/pull/71))
- ⚠️  Write declared procedures once ([#73](https://github.com/AntelopeJS/dms-automation/pull/73))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Maxime Westhoven <maxime@altab.be>

## v0.4.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/interface-v0.3.0...v0.4.0)

### 🚀 Enhancements

- **frontend:** The frontend registration as a pure function, declared as dmsFrontend ([#67](https://github.com/AntelopeJS/dms-automation/pull/67))

### 🩹 Fixes

- **frontend:** Run on @antelopejs/dms-frontend 0.7 ([#62](https://github.com/AntelopeJS/dms-automation/pull/62))
- **builder:** Label node ports with their field's translated title ([#59](https://github.com/AntelopeJS/dms-automation/pull/59))
- **frontend:** Fill the id of server-worded confirm dialogs ([#61](https://github.com/AntelopeJS/dms-automation/pull/61))
- **builder:** Confirm real effects before a test run and let actions dry-run ([#58](https://github.com/AntelopeJS/dms-automation/pull/58))

### 📖 Documentation

- Clarify learning paths and illustrate real outcomes ([#57](https://github.com/AntelopeJS/dms-automation/pull/57))

### 🏡 Chore

- **release:** @antelopejs/dms-automation v0.5.0 ([4ae0342](https://github.com/AntelopeJS/dms-automation/commit/4ae0342))
- **release:** @antelopejs/dms-automation v0.5.1 ([8ca61ad](https://github.com/AntelopeJS/dms-automation/commit/8ca61ad))

### ❤️ Contributors

- Maxime Westhoven ([@mwesto](http://github.com/mwesto))
- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.3.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/interface-v0.2.1...v0.3.0)

### 🚀 Enhancements

- Declare and run procedures from code, and survive module reloads ([#56](https://github.com/AntelopeJS/dms-automation/pull/56))

### 📦 Build

- Install frontend development dependencies from the root ([#54](https://github.com/AntelopeJS/dms-automation/pull/54))

### 🏡 Chore

- **release:** @antelopejs/dms-automation v0.4.1 ([4eba7c6](https://github.com/AntelopeJS/dms-automation/commit/4eba7c6))

### ❤️ Contributors

- Maxime Westhoven ([@mwesto](http://github.com/mwesto))
- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.1

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/interface-v0.2.0...v0.2.1)

### 🚀 Enhancements

- ⚠️  Migrate to DMS 0.9 and renderer 0.6 ([#49](https://github.com/AntelopeJS/dms-automation/pull/49))

### 🩹 Fixes

- **pages:** Name row fields with {{row.X}} tokens for dms 0.8 ([#45](https://github.com/AntelopeJS/dms-automation/pull/45))

### 💅 Refactors

- **frontend:** Declare the builder's test payload read with the dock's reads ([#50](https://github.com/AntelopeJS/dms-automation/pull/50))

### 📖 Documentation

- Add user guide and module skill ([#46](https://github.com/AntelopeJS/dms-automation/pull/46))
- Establish the automation consumer reference ([#51](https://github.com/AntelopeJS/dms-automation/pull/51))
- Make dense guide sections easier to scan ([#52](https://github.com/AntelopeJS/dms-automation/pull/52))

### 🏡 Chore

- **release:** @antelopejs/dms-automation v0.3.0 ([bb64ac2](https://github.com/AntelopeJS/dms-automation/commit/bb64ac2))
- **release:** @antelopejs/dms-automation v0.3.1 ([0250727](https://github.com/AntelopeJS/dms-automation/commit/0250727))
- **release:** @antelopejs/dms-automation v0.4.0 ([259ad87](https://github.com/AntelopeJS/dms-automation/commit/259ad87))
- **interface:** Raise verified foundation dependency floors ([#53](https://github.com/AntelopeJS/dms-automation/pull/53))

### ✅ Tests

- **runs:** Expect the table display before the grouped one ([#43](https://github.com/AntelopeJS/dms-automation/pull/43))

### 🤖 CI

- Speed up pipeline ([#44](https://github.com/AntelopeJS/dms-automation/pull/44))

#### ⚠️ Breaking Changes

- ⚠️  Migrate to DMS 0.9 and renderer 0.6 ([#49](https://github.com/AntelopeJS/dms-automation/pull/49))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.2.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/interface-v0.1.1...v0.2.0)

### 🚀 Enhancements

- **frontend-vue:** Declare the @antelopejs/dms-frontend releases the layer supports ([#31](https://github.com/AntelopeJS/dms-automation/pull/31))
- **frontend-vue:** Resolve i18n keys in automation type names ([#37](https://github.com/AntelopeJS/dms-automation/pull/37))
- **dms-automation:** ⚠️  Port the v2 design on dms 0.7 ([#39](https://github.com/AntelopeJS/dms-automation/pull/39))

### 🔥 Performance

- **db:** Index procedure run history and bound persisted run logs ([#29](https://github.com/AntelopeJS/dms-automation/pull/29))

### 🩹 Fixes

- **deps:** Relax @antelopejs/interface-database to >=0.1.7 <1.0.0 ([#30](https://github.com/AntelopeJS/dms-automation/pull/30))
- **deps:** Accept compatible 0.x versions of the interface packages ([#28](https://github.com/AntelopeJS/dms-automation/pull/28))
- **deps:** Cap @antelopejs/interface-dms-automation below the next minor and check interface ranges ([#33](https://github.com/AntelopeJS/dms-automation/pull/33))

### 💅 Refactors

- **pages:** Let the library and the builder fill the panel ([#34](https://github.com/AntelopeJS/dms-automation/pull/34))
- **runs:** Namespace the timeline display id as automation:timeline ([#38](https://github.com/AntelopeJS/dms-automation/pull/38))

### 🏡 Chore

- **playground:** Move to @antelopejs/dms-frontend 0.3.2 ([#27](https://github.com/AntelopeJS/dms-automation/pull/27))
- **release:** @antelopejs/dms-automation v0.2.1 ([45de366](https://github.com/AntelopeJS/dms-automation/commit/45de366))
- **release:** @antelopejs/dms-automation v0.2.2 ([cced507](https://github.com/AntelopeJS/dms-automation/commit/cced507))
- **release:** @antelopejs/dms-automation v0.2.3 ([bbc49f3](https://github.com/AntelopeJS/dms-automation/commit/bbc49f3))
- **release:** @antelopejs/dms-automation v0.2.4 ([8900e22](https://github.com/AntelopeJS/dms-automation/commit/8900e22))
- **release:** @antelopejs/dms-automation v0.2.5 ([269f353](https://github.com/AntelopeJS/dms-automation/commit/269f353))
- **release:** @antelopejs/dms-automation v0.2.6 ([3f2144c](https://github.com/AntelopeJS/dms-automation/commit/3f2144c))
- **playground:** Run api ^1.3.1 and open module source ranges ([#35](https://github.com/AntelopeJS/dms-automation/pull/35))
- **release:** @antelopejs/dms-automation v0.2.7 ([d152415](https://github.com/AntelopeJS/dms-automation/commit/d152415))

#### ⚠️ Breaking Changes

- **dms-automation:** ⚠️  Port the v2 design on dms 0.7 ([#39](https://github.com/AntelopeJS/dms-automation/pull/39))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.1.1

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/interface-v0.1.0...v0.1.1)

### 🩹 Fixes

- **deps:** Accept @antelopejs/interface-api 0.0.14 and later 0.x ([#25](https://github.com/AntelopeJS/dms-automation/pull/25))

### 🏡 Chore

- **release:** @antelopejs/dms-automation v0.2.0 ([aba9944](https://github.com/AntelopeJS/dms-automation/commit/aba9944))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.0

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/interface-v0.0.2...v0.1.0)

### 🩹 Fixes

- **release:** ⚠️  Publish with pnpm and depend on the interface by range ([#4](https://github.com/AntelopeJS/dms-automation/pull/4))
- **frontend:** ⚠️  Register the frontend module under its package name ([#5](https://github.com/AntelopeJS/dms-automation/pull/5))
- Update DMS playground CLI ([#11](https://github.com/AntelopeJS/dms-automation/pull/11))
- Use DmsClientOnly in automation editor ([#13](https://github.com/AntelopeJS/dms-automation/pull/13))
- **automation:** Route procedure pages through builder ([#14](https://github.com/AntelopeJS/dms-automation/pull/14))
- Route playground through public gateway ([#16](https://github.com/AntelopeJS/dms-automation/pull/16))
- **automation:** Read type-origin from the proxy's state registry ([#17](https://github.com/AntelopeJS/dms-automation/pull/17))

### 💅 Refactors

- **frontend:** Import the SDK through #dms/frontend-module ([#10](https://github.com/AntelopeJS/dms-automation/pull/10))
- **build:** Merge tsconfig.build.json into tsconfig.json ([#20](https://github.com/AntelopeJS/dms-automation/pull/20))
- **package:** ⚠️  Drop moduleResolution node support and pack-based checks ([#23](https://github.com/AntelopeJS/dms-automation/pull/23))

### 🏡 Chore

- **release:** Build the interface package before releasing the runtime ([#3](https://github.com/AntelopeJS/dms-automation/pull/3))
- **release:** @antelopejs/dms-automation v0.0.2 ([184a8a2](https://github.com/AntelopeJS/dms-automation/commit/184a8a2))
- **release:** @antelopejs/dms-automation v0.1.0 ([946a5ee](https://github.com/AntelopeJS/dms-automation/commit/946a5ee))
- **release:** @antelopejs/dms-automation v0.1.1 ([a0dec4c](https://github.com/AntelopeJS/dms-automation/commit/a0dec4c))
- Require @antelopejs/core 1.7 ([#8](https://github.com/AntelopeJS/dms-automation/pull/8))
- Align community files with the organization defaults ([#9](https://github.com/AntelopeJS/dms-automation/pull/9))
- **release:** @antelopejs/dms-automation v0.1.2 ([f6e2383](https://github.com/AntelopeJS/dms-automation/commit/f6e2383))
- Add orb setup for DMS playground ([#12](https://github.com/AntelopeJS/dms-automation/pull/12))
- **release:** @antelopejs/dms-automation v0.1.3 ([db22b21](https://github.com/AntelopeJS/dms-automation/commit/db22b21))
- **playground:** Use dms frontend 0.2.1 ([#15](https://github.com/AntelopeJS/dms-automation/pull/15))
- **release:** @antelopejs/dms-automation v0.1.4 ([dd355b7](https://github.com/AntelopeJS/dms-automation/commit/dd355b7))
- **release:** @antelopejs/dms-automation v0.1.5 ([a5fd13b](https://github.com/AntelopeJS/dms-automation/commit/a5fd13b))
- **agents:** Install Node 24 in setup script ([#18](https://github.com/AntelopeJS/dms-automation/pull/18))

### 🤖 CI

- **release:** Release next from a dedicated branch and restore requireCommits ([#21](https://github.com/AntelopeJS/dms-automation/pull/21))
- **release:** Reference the shared release workflows through v1 ([#22](https://github.com/AntelopeJS/dms-automation/pull/22))

#### ⚠️ Breaking Changes

- **release:** ⚠️  Publish with pnpm and depend on the interface by range ([#4](https://github.com/AntelopeJS/dms-automation/pull/4))
- **frontend:** ⚠️  Register the frontend module under its package name ([#5](https://github.com/AntelopeJS/dms-automation/pull/5))
- **package:** ⚠️  Drop moduleResolution node support and pack-based checks ([#23](https://github.com/AntelopeJS/dms-automation/pull/23))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.2

[compare changes](https://github.com/AntelopeJS/dms-automation/compare/interface-v0.0.1...v0.0.2)

### 🏡 Chore

- Regenerate lockfiles against the published DMS packages ([#1](https://github.com/AntelopeJS/dms-automation/pull/1))
- **release:** Skip the npm auth pre-flight for trusted publishing ([#2](https://github.com/AntelopeJS/dms-automation/pull/2))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

