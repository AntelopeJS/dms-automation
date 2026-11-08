---
name: formal-leader-triggers
description: TLA+ model of the redis-mode leader election of @antelopejs/dms-automation (the dms-automation:leader key, the renew and SET NX tick, holdsLock, the serial reconcile that arms singleton triggers, and destroy()), checked with TLC. Use when a change touches packages/dms-automation/src/cluster/leader.ts, the leadership hooks of src/runtime/subscriptions.ts, the leader snapshot in src/runtime/reconcile.ts or destroy() in src/index.ts, or needs proof that it arms singleton triggers on one instance only.
---

# Formal check: leader election and singleton triggers

In redis mode, every instance of `@antelopejs/dms-automation` contends for the key `dms-automation:leader` (`SET NX PX`, TTL 30 s, a tick every 10 s, an owner-checked renew and release in Lua). The instance that believes it holds the key (`holdsLock`) arms the singleton triggers, schedules and webhooks, through a reconcile on its serial queue. The other instances arm only the replicated ones. Two armed instances fire every singleton trigger twice.

The model treats each Redis round trip as one step, and TLC checks every order of those steps across two instances, a Redis error, a peer's edit, one `destroy()` and ticks of the clock, within the bounds below. An instance can stall: it takes no step while time passes. The promise it checks is that the singleton triggers are armed on one instance at most, and that a stopped instance leaves nothing behind.

- `LeaderTriggers.tla` holds the variables, the actions and the rules. Each condition carries a `file.ts:NN` comment; `leader.ts` is `packages/dms-automation/src/cluster/leader.ts`, and the other names are under `packages/dms-automation/src/`.
- `Running.cfg` (no instance stops) and `Shutdown.cfg` (one instance runs `destroy()`) are the full configurations. Each has a `.ci.cfg` twin, the CI configuration.
- `LeaderTriggers.map.mjs`, `chart-stall.cfg` and `chart-shutdown.cfg` are for reading results with `/statechart`.

## Run it

From the repository root, with Node 24 and `pnpm install` done (the runner comes from `@antelopejs/tooling-configs/formal`):

```sh
node .agents/skills/formal-leader-triggers/check.mjs          # CI configuration
node .agents/skills/formal-leader-triggers/check.mjs --full   # full configuration
```

Java 11 or later comes from `$JAVA`, else `java` on PATH, else the `eclipse-temurin:21-jre` Docker image (set `TLC_DOCKER_PREFIX` to name the containers). The first run downloads TLC 1.7.4 into `~/.cache/antelopejs-formal` (or `$XDG_CACHE_HOME/antelopejs-formal`) and checks its SHA-256. Each run checks the running cluster first, then the shutdown, then the handoff.

| Configuration | Last tick (10 s each) | States (running, shutdown, handoff) | Wall time |
| --- | --- | --- | --- |
| CI (`<config>.ci.cfg`) | 5, handoff 2 | 54,251, 458,987, 28,457 | 22.1 s |
| Full (`<config>.cfg`) | 7 running, 6 shutdown, 2 handoff | 218,349, 941,077, 28,457 | 31.2 s |

Every configuration runs two instances, one Redis error and one reconcile queued by a peer's edit. `Handoff` is `Shutdown` stopped at tick 2, before any key can expire, so F1 cannot happen there and a shutdown that leaves two instances armed breaks a rule; its CI and full files are the same. The times are one run each in Docker Java 21 on a shared 32-core machine with a load average near 69; most of it is container and JVM start-up for the TLC runs.

- Exit 0 means every rule that held still holds, and each finding still breaks with its recorded counterexample length.
- Exit 1 means a rule changed. `BROKEN` names a rule that held and now breaks. `CHANGED` names a finding whose shortest counterexample changed length. `HOLDS` names a finding that no longer breaks. The script keeps TLC's output in a temporary folder and prints its path. The run stops at the first configuration that changed, so a change in the running cluster skips the shutdown.
- Exit 2 means TLC or Java could not run, or the arguments were wrong.

The lines that name a changed rule match `^(?:BROKEN|CHANGED|HOLDS) +(\w+)`. A rule that still holds prints as lowercase `holds`.

A rule with a recorded finding is judged by the length of its shortest counterexample alone. A change that adds a longer counterexample to a recorded finding exits 0, so a regression of `AtMostOneArmed` stays green while its finding stands. `antelopejs-verify formal` closes that gap for a diff: while a finding stands, it fails a verdict whose diff changes the covered behaviour. Fixing the finding closes the gap for good. Three CI runs and two full runs on one machine printed identical lengths and paths; the check judges lengths only.

## When to run it

Run `--full` when a change touches a file in the coverage record below, or this folder. CI runs the CI configuration on every push (job `formal-leader-triggers`, in the `ubuntu` gate). The repository has no verification skill yet; when `verify-dms-automation` lands, its `verify.config.ts` takes a `formal` entry for this check, so a verdict fails on a changed rule, and on a recorded finding only when the diff changes the covered code.

## The rules

| Rule | Plain sentence | Harm when it breaks | Running (CI, full) | Shutdown (CI, full) | Handoff (CI, full) |
| --- | --- | --- | --- | --- | --- |
| `AtMostOneArmed` | At most one instance has the singleton triggers armed. | Every schedule and webhook trigger fires twice. | finding F1 (12, 12) | finding F1 (12, 12) | holds (F2 fixed) |
| `ArmedImpliesBelief` | An armed instance believes it holds the lock. | An instance that knows it lost the lock still fires the singletons. | finding F1 (11, 11) | finding F1 (11, 11) | holds (F2 fixed) |
| `StopDisarms` | Once `destroy()` returned, the instance has nothing armed, does not believe it leads, and holds no live key. | A stopped instance blocks leadership for a TTL, or arms triggers in a module that is gone. | holds | holds (F3 fixed) | holds |

`TypeOK` holds too. The numbers in brackets are the states of TLC's shortest counterexample, which `check.mjs` records per configuration. The plan's `EventuallyLeader` (with no stalls, some instance is eventually armed) is a liveness rule, which the shared runner does not check.

## Findings on campaign/integration

Each finding was replayed on `packages/dms-automation/dist/cluster/leader.js` built at the sync commit, against a real Redis 7. The replays were scratch scripts and are not committed. The replay loads two copies of the compiled module, each with its own instance id, a fake clock, fake timers and an ioredis client whose `set` and `eval` calls wait until the replay releases them to Redis. When the clock passes the key's expiry, the replay deletes the key, as Redis does after `TTL_MS`. The transitions the module receives stand in for `subscriptions.onBecameLeader` and `onLostLeadership`: each queues a reconcile that the replay runs in two steps, reading `isLeader()` and then arming or disarming. It releases one command or fires one event per model action, in TLC's order.

- **F1, a stalled leader keeps its triggers armed (`AtMostOneArmed`, `ArmedImpliesBelief`, `Running`).** `holdsLock` stays true until the leader's own tick learns the key is gone: a renew that answers 0 (leader.ts:119), or an error once `Date.now() - lastHeldAt > TTL_MS` (line 128). Nothing fences it, and a trigger's `emit` reads only its handle's `live.armed` (reconcile.ts:289), never `isLeader()`. In TLC's counterexample for `AtMostOneArmed`, i1 wins the key and arms, its next tick stalls, the key expires after three ticks, and i2 wins it and arms. The replay ended with `i1 { armed: true, isLeader: true }`, `i2 { armed: true, isLeader: true }` and the key `i2`. For `ArmedImpliesBelief`, i1's renew lands after the expiry and answers 0: the replay logged `i1 renew -> 0` and ended with i1 `{ armed: true, isLeader: false }` and its disarming reconcile still queued. That window follows every step-down.
- **F2, destroy() hands the key over before it disarms (`AtMostOneArmed`, `ArmedImpliesBelief`, `Shutdown`). Fixed for #112.** `destroy()` now points the leadership source at false, halts the leader (no tick starts, the in-flight one is awaited, the key is kept), closes the bus, tears the handles down at once and again after the pending reconciles, and only then releases the key (index.ts:168-176, leader.ts:214-247). When the second teardown misses its cap, it keeps the key and leaves it to expire. `tests/destroy-order.test.cjs` drives that order against a fake Redis. In `Shutdown`, both rules now break only through F1's stall; in `Handoff`, where no key expires, both hold. Before the fix: `destroy()` runs `leader.stop()`, which deletes the key and clears `holdsLock` (leader.ts:183-186), then `bus.close()`, and only then `_deactivateAll()` (index.ts:166-168). In TLC's counterexample, i1 leads and is armed, destroy releases the key, and i2 wins it and arms before i1's handles are torn down. The replay logged `i1 release -> 1`, `i1 leader.stop() returned`, `i2 set -> "OK"`, and ended with `i1 { armed: true, isLeader: false }` and `i2 { armed: true, isLeader: true }`.
- **F3, a stopped instance leads or re-arms (`StopDisarms`, `Shutdown`). Fixed for #111.** A tick that answers after `stop()` began does not promote or step down and releases a key it wins, and `_deactivateAll()` tears the handles down at once and again after the pending reconciles. Both shutdown waits stay capped, so the fix holds under the two timing bounds in Bounds and what is left out. `tests/leader-stop.test.cjs` and the `_deactivateAll()` test of `tests/trigger-rearm.test.cjs` replay both paths below against the built module. The finding as it stood: `stop()` waits for the in-flight tick at most `SHUTDOWN_GRACE_MS` (leader.ts:174-182). A `SET NX PX` sent before the stop and answered after it still runs `promote` (lines 123-125, 86-99). In TLC's counterexample, i1's first tick sends `SET`, destroy starts, its wait gives up, nothing is released, the `SET` answers `OK`, and destroy finishes. The replay logged `i1 stop's grace runs out`, `i1 leader.stop() returned`, `i1 set -> "OK"`, and ended with i1 `{ armed: false, isLeader: true }`, one reconcile queued that reads that leadership, and the key `i1`. A second path is two states longer and shows once the late `SET` is fixed (the `fix-late-set-after-stop` row below): `_deactivateAll` runs outside the reconcile queue (subscriptions.ts:419-426), so a reconcile that read leadership before the stop arms after the teardown. Its replay logged `i1 reconcile reads isLeader() = true`, `i1 stop's grace runs out`, `i1 release -> 1`, `i1 leader.stop() returned`, `i1 _deactivateAll tears the singleton down`, `i1 reconcile arms the singleton`, and ended with i1 `{ armed: true, isLeader: false }`.

Filed as AntelopeJS/dms-automation#113 (F1), #112 (F2, fixed) and #111 (F3, fixed).

## Read every result with /statechart

Read each TLC result with the pstack `/statechart` skill. Work on a copy of `LeaderTriggers.tla`, the map and the chart configs in a scratch folder outside the repo, since it writes its output next to its input. Use `LeaderTriggers.map.mjs` as the view: one region for the key and one per instance. `chart-stall.cfg` (no stop, no error, three ticks) reaches 1,151 states, above the 500-state chart budget, so it draws only the bug paths, 11 states and 8 arrows: `ArmedImpliesBelief` in 10 steps and `AtMostOneArmed` in 11. `chart-shutdown.cfg` (one stop, one tick) reaches 3,949 states and draws 14 states and 12 arrows: `ArmedImpliesBelief` and `StopDisarms` in 7 steps each, `AtMostOneArmed` in 11. `TypeOK` and `NoDeadlock` hold in both, and `StopDisarms` holds in the first. The view hides `Settled`, the step that changes nothing once nothing else can happen. A new bug shows as a new numbered path, and a fix shows which bug paths it removes.

## Real bug or modeling error

Node runs other callbacks at every `await`, so Redis answers, interval ticks and reconcile steps can interleave in any order the model allows, and a stalled instance takes no step while time passes. `GetClient()` returns a resolved promise once interface-redis has its client, so the await in `start()` sends nothing else first. A step order is a modeling error when the code cannot produce it, for example a reconcile that reads leadership before the hook that queued it set `holdsLock`, or a tick running while `ticking` is set. Replay a counterexample with the replay described above, one action per step, and assert only what the cluster observes: which instances arm, `isLeader()`, and the key in Redis. The replay stands in for the reconcile, so a finding that depends on what `reconcile()` does with the procedures needs a replay through the module's own tests in `packages/dms-automation/src/**/*.test.ts`. If the replay does not reproduce a finding, treat the model as wrong until you show it is not.

## Changing the model

- For an intended code change, edit the action that maps to that code, keep the `file.ts:NN` comment on each condition and update its line, then run both configurations.
- Never weaken or drop a rule to make the check pass. A fixed finding leaves `RUNNING` or `SHUTDOWN` in `check.mjs`, for every configuration, once a replay confirms the fix. A new finding goes in with its counterexample length for each configuration, and into this file with its replay.
- When you change the bounds of a `.ci.cfg`, rerun the scratch changes below on it. The CI configuration must still catch each one.
- After you confirm that the model describes the code at a newer commit, move the sync commit forward. Do it only then.

## Coverage record

| Model action | Code |
| --- | --- |
| `Init` | every instance has run `start()`, whose first tick is due (leader.ts:195-201) after hydrate (index.ts:143-160) |
| `RunTick` | the interval and `runTick` (leader.ts:180-186, 200), the `ticking` guard and the command each branch sends (lines 152-159, 115-117, 132-133) |
| `RenewReply` | `RENEW_LUA` (lines 19-20), the answer 0 that steps down (lines 124-125, 161, 66-72), a renewed hold (lines 120-122), an error (lines 162-168), and an answer after `stop()` began that ends the tick (lines 119, 164) |
| `SetReply`, `LateRelease` | `SET NX PX`, the hold it sets and `promote` (lines 132-143, 160, 93-109); once `stop()` began, the release of the key it won instead (lines 136-138) |
| `TickDone` | the tick awaits the reconcile its hook queued (subscriptions.ts:220-229, 62-66) |
| `ReconcileRead`, `ReconcileApply` | `reconcile()`: the leader snapshot after its reads, then the diff it applies (reconcile.ts:248-270, 85-90), one pass at a time (serialQueue.ts:20-38) |
| `External` | a procedure edit or a peer's bus message queues a reconcile (subscriptions.ts:177-183, 230-235, 259-266) |
| `StopBegin`, `StopWait` | `destroy()` points the leadership source at false, so every later reconcile reads no leadership, then calls `leader.halt()`: the interval cleared, `generation` bumped, the capped wait for the tick (index.ts:171-172, leader.ts:214-232, 203-212) |
| `StopBus`, `StopDeactivate` | `bus.close()`, then `_deactivateAll()`: every handle torn down at once, and again on the reconcile queue after every reconcile queued before it, with a capped wait (index.ts:173-174, subscriptions.ts:447-461) |
| `StopRelease` | `leader.stop()`: the owner-checked release with a cap of its own, `holdsLock` cleared (index.ts:175, leader.ts:240-247) |
| `Tick` | `TICK_MS` passes (leader.ts:10) |

The sync commit is `e755b34` on AntelopeJS/dms-automation `campaign/integration`. `leader.ts` and `index.ts` last changed in `aeb6988`, `reconcile.ts` and `subscriptions.ts` in `be9f793`, so the files above are byte-identical to `3d5b6d7`, where the model was written and each finding replayed. The fix of #111 changed `leader.ts` and `_deactivateAll()` in `subscriptions.ts`; the actions that map to them and their line numbers follow that change. The fix of #112 then changed `destroy()` in `index.ts`, split `leader.stop()` into `halt()` and `stop()`, and made `_deactivateAll()` report whether its second teardown finished; the `Stop*` actions follow it, and `reconcile.ts` is unchanged.

## Bounds and what is left out

One tick is 10 s and the key lives three ticks. Both configurations run two instances, one Redis error and one peer reconcile; `Shutdown` lets one instance run `destroy()`. A pass covers these bounds only.

The model assumes two timing bounds that the code caps rather than waits for:

- a Redis round trip answers within `SHUTDOWN_GRACE_MS` (leader.ts:16), so `StopWait` waits for the tick's commands and `StopRelease` for the release. When it does not, `stop()` returns at the cap. A key the tick wins late is released one round trip later, and a release that never answers leaves the key to expire after `TTL_MS`: for that time a stopped instance holds the key. `tests/leader-stop.test.cjs` checks both.
- the reconciles pending at `destroy()` settle within `PENDING_RECONCILES_WAIT_MS` (subscriptions.ts:72), so `StopDeactivate` waits for them. When they do not, `_deactivateAll()` returns `false` at the cap with every handle torn down, and `destroy()` keeps the key, which expires after `TTL_MS`. A handle a late reconcile arms stays armed until the queued teardown right behind it runs, and no peer can arm before the key expires. A reconcile still arming when the key expires is a stall, as in F1. A `start()` in the same process before that expiry cannot win its own kept key, since `SET NX` fails on it, so no instance leads until it expires.

The model leaves out:

- one singleton trigger stands for all of them: a reconcile arms or disarms them together, as it does when every enabled procedure's singleton reads the same leader snapshot (reconcile.ts:241-245).
- a trigger that fails to activate or deactivate, the `TRIGGER_OP_TIMEOUT_MS` bound, and a promotion whose reconcile rejects (leader.ts:98-107).
- an instance that crashes; its key expires as in a stall, and its triggers die with it.
- a Redis error after Redis applied the command; an error here is a command Redis never applied.
- a third instance: both configurations run two, and a third adds interleavings that no run here covers.
- memory mode, where every instance is leader.
- what the triggers do when they fire, and the bus itself.

One scratch change breaks no rule, because it only adds ways to reach F1 without shortening its counterexample: `renew-without-owner-check`, a renew that extends the key whoever owns it (leader.ts:19-20), exits 0 in both configurations. A leader that renews a peer's key keeps believing it leads, which F1 already records.

## Confirm the check can fail

On a scratch copy of this folder (with `node_modules` reachable, for example a symlink beside it), apply one model edit at a time and run `check.mjs` with and without `--full`. Each edit mirrors the code change in the first column. The first five ran at the sync commit, the rest on the fix of #112.

| Scratch change in the code, and the model edit | CI configuration | Full configuration |
| --- | --- | --- |
| `set-without-nx`: the follower's `SET` drops `NX` (leader.ts:123): `SetReply` always takes the key | `CHANGED AtMostOneArmed: 9 states (recorded 12)` | same |
| `renew-zero-keeps-lock`: a renew that answers 0 keeps `holdsLock` (leader.ts:119): `RenewReply` ends the tick | `CHANGED ArmedImpliesBelief: 12 states (recorded 11)` | same |
| `step-down-a-tick-early`: an error steps down once `Date.now() - lastHeldAt >= TTL_MS - TICK_MS` (leader.ts:128) | `CHANGED ArmedImpliesBelief: 10 states (recorded 11)` | same |
| Fix candidate `fix-teardown-before-release`: `destroy()` tears the handles down before `leader.stop()` releases the key (index.ts:166-168) | running unchanged; shutdown `CHANGED ArmedImpliesBelief: 9 states (recorded 8)`, `CHANGED StopDisarms: 7 states (recorded 8)`: a reconcile already past its read re-arms after the teardown | same |
| Fix candidate `fix-late-set-after-stop`: a `SET` that answers after stop does not promote (leader.ts:123-125): `SetReply` of a stopping instance ends the tick | running unchanged; shutdown `CHANGED StopDisarms: 10 states (recorded 8)`, the re-arm path of F3 | same |
| `late-set-keeps-key`, after the fix of #111: a `SET` that wins after stop does not release the key (leader.ts:134-136): `SetReply` of a stopping instance ends the tick | running unchanged; shutdown and handoff `BROKEN StopDisarms` in 8 states, the late `SET` path of F3 | same |
| `teardown-outside-queue`, after the fix of #111: `_deactivateAll()` tears down only outside the reconcile queue (subscriptions.ts:451): `StopBus` queues nothing and `StopDeactivate` waits for no reconcile | running unchanged; shutdown `BROKEN StopDisarms` in 11 states, the re-arm path of F3 | same |
| `release-first`, the order before #112: `leader.stop()` releases before `bus.close()` and `_deactivateAll()` (index.ts:172-175): `StopWait` goes to `StopRelease`, then `StopBus` | running unchanged; shutdown `CHANGED ArmedImpliesBelief: 8 states (recorded 11)`, F2 | same |
| `no-halt`: `destroy()` tears down while the leader still contends (index.ts:172): `StopBegin` keeps the interval and skips `StopWait` | running unchanged; shutdown `BROKEN StopDisarms` in 8 states, a late `SET` promotes after the teardown | same |
| `no-leadership-switch`: reconciles during `destroy()` still read leadership (index.ts:171): `ReconcileRead` snapshots `holds[i]` alone | running unchanged; shutdown `BROKEN StopDisarms` in 14 states, a peer's reconcile after the queued teardown re-arms; the last test in `tests/destroy-order.test.cjs` catches it too | same |

Every scratch run in the table exited 1. With the edits dropped, both configurations exit 0.
