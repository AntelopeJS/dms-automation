---
name: verify-dms-automation
description: "Drive the AntelopeJS dms-automation module (procedures as node graphs, the builder, triggers, webhooks and schedules, runs and traces, the Overview, the Library and templates, the interface other modules register nodes through) the way the platform owner does, inside a DMS with free ports, its own MongoDB database, an HTTP sink and a fixture module, and post a verdict with evidence. Use to prove a change to AntelopeJS/dms-automation works before merge, or to verify a PR."
---

# Verify dms-automation

Every deterministic step is a `dms-control` command. You choose which journeys to run and judge what they show; you never write a multi-step shell recipe. When a journey you need does not exist, add it to `journeys/<feature>.mjs`, describe it in its feature file, and run it.

`dms-control` is the bin of `@antelopejs/dms`, a devDependency of `packages/dms-automation`. Run it with Node 24 after `pnpm install`, through that package:

```bash
C="pnpm --dir packages/dms-automation exec dms-control"
$C                       # lists every command
```

Give `doors` and `--skill` absolute paths: the command runs in `packages/dms-automation`.

## Launch

```bash
RUN=$($C up --prepare --base origin/campaign/integration)   # installs, builds, starts; prints the run folder
```

`--prepare` runs the `prepare` commands of `verify.config.ts`: the frozen install, the build of the interface and the module, `playwright-core` into this folder, the link of the playground's `node_modules` to `packages/dms-automation/node_modules`, `fetch-api.mjs` (see Gotchas) and the TypeScript build of the playground's fixture module. Without it `up` uses the builds already there, and `doctor` fails on a stale one. `up` starts an isolated DMS from `playground/`:

- the checkout is laid out again under `$RUN/root`, every sibling linked, and the playground copied without `node_modules`, so the run's build, `.antelope/` and data are its own;
- the API, the dashboard and the mail sink get free ports from the kernel, and `HOME` is `$RUN/home`;
- a `mongod` the run owns serves `verify_<run>` databases;
- the backend runs `ajs project start -e docs`, the dashboard `ajs dms start -e docs -b <api>`.

The fixture module (`playground/src`) serves what a journey cannot do over the module's own HTTP API, under `/verify-auto`: the ledger of what its nodes did, `emit` to fire its triggers, `invoke`, `run` and `declare` (the interface's `InvokeProcedure`, `RunProcedure`, `DeclareProcedure`), `types` to list, unregister, register and define node types at run time, a member with a role (`POST /member`) and the address of an HTTP sink the HTTP request action calls (status, redirect, big, slow, chunked and reset answers). It registers the `verify.*` node types: actions that echo, record effects (with and without `dryRun`, with `sideEffects: false`), fail, throw non-Error values, resolve with an array, a string or nothing, log, count, sleep and read their context; data nodes that upper-case, add a configured suffix, evaluate to an array or throw; and triggers that fire on `emit` (replicated and singleton), cannot arm, never arm or never disarm.

## Doctor

```bash
$C doctor "$RUN"          # prints only failing checks; --verbose prints all
```

Do not drive a run that fails doctor.

## Drive

```bash
$C plan --base origin/campaign/integration   # the diff mapped to features; unmapped surfaces
$C journey "$RUN" smoke
$C journey "$RUN" runs [journey-id...]
```

- Each feature file in [features/](features/README.md) lists its source globs (`covers:`), its docs pages (`docs:`) and its journeys; the journeys are in `journeys/<feature>.mjs` and `journeys/parts/`, with the helpers they share in `auto.mjs` (requests, checks, `raw` for any HTTP method), `procs.mjs` (graph builders, procedures, runs, `withConfig`, `declareFile`, the ledger) and `guard.mjs` (environment loss). [coverage/](coverage) holds one table per feature: every documented behaviour, its catching journey and check, or `Not driven` with the reason.
- A journey starts on an empty database with the administrator onboarded and the backend restarted on it, so run-time registrations and configuration switches are gone. It reads every mutation back through a second view: the API, a reload, the run's trace and logs, the fixture's ledger, the stored database or a backend restart.
- `withConfig(ctx, { VERIFY_AUTO_*: … }, body)` restarts the backend with module options set (`RETENTION_DAYS`, `SENSITIVE_NAMES`, `BLOCK_PRIVATE`, `CLUSTER_DRIVER`, `API_BASE_URL`, `DECLARE`; see `playground/antelope.config.ts`) and restarts it again without them.
- To look at the product yourself: `$C onboard "$RUN"`, `$C browser "$RUN" login`, `goto --path`, `snapshot`, `click --role --name`, `fill`, `press`, `screenshot`, `$C api "$RUN" <method> <path> [--as anon] [--body <json>]`, `$C reset "$RUN"`. Each writes its evidence under `$RUN/evidence/`.

## Evidence

Everything goes under `$RUN/evidence/`: `<feature>/<journey>/NN-<step>/` with `action.json`, `url.txt`, `aria.yml` and `screenshot.png` for a browser step, `request.json` and `response.json` (status, headers, size and SHA-256 of the body) for a request, and `checks.json` for every step that checks something; `<feature>/<journey>/result.json` and `<feature>/feature.json`. Read the evidence before you judge a PASS: a check passing proves only what it asserts.

## Cleanup

```bash
$C down "$RUN"
```

## Verdict rules

1. **Run every feature whose `covers:` globs the diff touches, plus the smoke journey.** `plan` prints that list as `run`.
2. **Unmapped surface fails the verdict.** User-facing code is `packages/dms-automation/src/**`, `frontend-vue/**`, `skills/**`, `package.json`, and `packages/interface-dms-automation/src/**`, `skills/**` and `package.json`, tests and tool configs excluded (`verify.config.ts`). `map` checks the whole tree.
3. **Every registered journey of a feature in `run` must have run and passed.** Known findings stay as failing journeys (see Gotchas): they fail a verdict only when the diff touches their feature.
4. **Docs.** Judge every `docs:` page of each touched feature against what the journeys showed.
5. **Formal checks.** `formal-leader-triggers` covers the leader election of the Redis mode: `$C formal "$RUN"` runs it when the diff touches its files.
6. **One-way doors.** The section comes right after the result line and is mandatory. `$C doors` prints the `One-way-door:` line for the diff.
7. **Result.** FAIL if any of rules 1 to 6 fail. PASS+NOTES when something is not verified or needs the owner's attention. PASS otherwise.

Write `$RUN/evidence/judgement.json` (`doors`, `docs`, `notVerified`, `attention`, `verifier`), then `$C verdict "$RUN" --pr <n>` and, from a thread that did not write the change, `$C publish "$RUN" --pr <n>`.

## Trust

The skill is not Trusted yet. It becomes Trusted when it passes a shadow run of 10 consecutive agent PRs, and its last maintain pass is newer than the last change to the repository or its `@antelopejs` dependencies and at most 30 days old.

## Gotchas

- The published `@antelopejs/api` 1.6.0 reads `handler.proto.constructor`, while the module registers its webhook routes with `RouteHandler.controller`, so every webhook call answers 500 with it. `fetch-api.mjs` (a prepare step) unpacks that package into `api-module/` next to the playground with one line changed to read `controller` first; the playground loads it as a local module. Remove the step when a released api module reads `controller`.
- Every dashboard page renders on the server and hydrates after `load`; a click that lands first does nothing. The journeys click again until what the click opens shows, and `tab.signIn` waits for the sign-in form to hydrate.
- A journey that needs old or hand-made runs writes them through the MongoDB driver that `mongodb-memory-server-core` brings (`dms-control` resolves it the same way), then reads them back through the API and the pages.
- `mongod` comes from `DMS_CONTROL_MONGOD`, `PATH`, or the mongodb-memory-server cache (`~/.cache/mongodb-binaries`).
- A step whose check fails because the backend or the dashboard stopped answering ends the journey with a `NOT VERIFIED` error and no failing check (`guard.mjs`).
- The Overview feature has 25 journeys and takes about 25 minutes on one run; the rule that every journey of a touched feature must run is met by splitting its journey ids over two runs (`$C up` twice, `$C journey "$RUN" overview <ids...>`) rather than by skipping some.
- Some journeys take 30 to 45 s on purpose (a trigger that never arms waits for the module's 10 s timeouts; the HTTP request action's default timeout is 30 s).
- Known findings at the integration head are failing journeys, each with an issue draft; the list is in the pull request's Attention section.

## Not driven

List these under `notVerified` in the judgement of every verdict. The per-feature reasons are in [coverage/](coverage).

- Redis mode: leader election and its 30 s lease, handover, pub/sub of edits between instances, `cluster.driver: redis` with the interface present. The playground has no Redis; `formal-leader-triggers` checks the election.
- The Table watch trigger and the nodes of `dms-database` and `dms-api`: the playground loads neither module, and the change feed needs a MongoDB replica set.
- A module reload or stop during a run or an activation, registrations made before an implementation attaches, `ModuleContextInvalidatedError`: the run starts the project without reloads and with the implementation present.
- The hourly purge of old runs and the 24-hour clock: a journey can age stored runs and restart the backend (driven), but cannot wait an hour.
- Dragging a block or the drawer's edge, solid and dashed edge styles, colours: the harness has no pointer drag and the accessibility tree has no styles.
- The public-host half of the HTTP request action's redirect and DNS rules with `blockPrivateNetwork` on: every address the run can reach is private.

## Feature map

[features/README.md](features/README.md).
