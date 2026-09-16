import { Logging } from "@antelopejs/interface-core/logging";
import { GetClient } from "@antelopejs/interface-redis";
import { instanceId } from "./instance";

type RedisClient = Awaited<ReturnType<typeof GetClient>>;

const LOCK_KEY = "dms-automation:leader";
const TTL_MS = 30_000;
const TICK_MS = TTL_MS / 3; // tolerate two missed renews before expiry
// Cap on how long stop() waits for an in-flight tick before tearing down anyway,
// so shutdown can't hang on a wedged trigger op.
const SHUTDOWN_GRACE_MS = 5_000;

// Extend the lock only if we still own it.
const RENEW_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
// Delete the lock only if we still own it (fast handoff on shutdown).
const RELEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export interface LeaderTransitions {
  onBecameLeader(): Promise<void>;
  onLostLeadership(): Promise<void>;
}

let client: RedisClient | undefined;
let timer: NodeJS.Timeout | undefined;
// Whether THIS instance currently holds the lock. The single source of truth
// for leadership: subscriptions reads it live via `isLeader()` rather than
// keeping its own copy, so the two can't drift.
let holdsLock = false;
let transitions: LeaderTransitions | undefined;
let ticking = false;
// The in-flight tick, if any — `stop()` awaits it so teardown never races a
// running acquire/renew/transition.
let currentTick: Promise<void> | undefined;
// Wall-clock (ms) of the last CONFIRMED lock hold — an acquire or a successful
// renew. Bounds how long a leader keeps believing it leads through transient
// errors: only once TTL has elapsed without a confirmed renew is the key sure
// to have expired (so a peer may have legitimately taken over).
let lastHeldAt = 0;

/** Does this instance currently hold the leader lock? Read live by subscriptions. */
export function isLeader(): boolean {
  return holdsLock;
}

async function stepDown(): Promise<void> {
  holdsLock = false;
  // Swallow a faulty callback so it can't escape the fire-and-forget tick loop.
  try {
    await transitions?.onLostLeadership();
  } catch (err) {
    Logging.Error("[dms-automation] leader: onLostLeadership failed:", err);
  }
}

// Delete the lock if (and only if) we still own it. Used on graceful stop and
// when a promotion's side-effects fail, so the lock doesn't linger held by an
// instance that isn't actually running the singletons.
async function release(): Promise<void> {
  if (!client) return;
  try {
    await client.eval(RELEASE_LUA, 1, LOCK_KEY, instanceId);
  } catch (err) {
    Logging.Error("[dms-automation] leader: release failed:", err);
  }
}

// Won the lock: become leader and arm singletons. On failure, release the lock
// and step down so a fresh election — our next tick or a peer — retries cleanly,
// instead of holding leadership with no singletons running.
async function promote(t: LeaderTransitions): Promise<void> {
  holdsLock = true;
  lastHeldAt = Date.now();
  try {
    await t.onBecameLeader();
  } catch (err) {
    Logging.Error(
      "[dms-automation] leader: promotion failed, releasing lock:",
      err,
    );
    holdsLock = false;
    await release();
  }
}

async function tick(): Promise<void> {
  if (!client || !transitions || ticking) return; // skip if a tick is still in flight
  const t = transitions;
  ticking = true;
  try {
    if (holdsLock) {
      const renewed = Number(
        await client.eval(RENEW_LUA, 1, LOCK_KEY, instanceId, String(TTL_MS)),
      );
      // renewed === 0 → definitive loss (key gone or owned by another instance).
      if (renewed === 0) await stepDown();
      else lastHeldAt = Date.now();
      return;
    }
    if ((await client.set(LOCK_KEY, instanceId, "PX", TTL_MS, "NX")) === "OK") {
      await promote(t);
    }
  } catch (err) {
    // Transient redis error. Do NOT step down on the first failure: the lock is
    // almost certainly still ours (its TTL has not lapsed), and a false
    // step-down would black out singleton triggers cluster-wide while this
    // instance still owns the un-expired key (which also blocks re-acquire).
    // Relinquish only once TTL has elapsed since the last confirmed hold.
    Logging.Error("[dms-automation] leader: tick failed:", err);
    if (holdsLock && Date.now() - lastHeldAt > TTL_MS) await stepDown();
  } finally {
    ticking = false;
  }
}

// Run a tick and expose it as `currentTick` for stop() to await. Skips while a
// tick is already in flight so the interval can't overwrite the running tick's
// handle with a no-op (which would let stop() race a still-running tick). The
// finally only clears `currentTick` if it still points at this tick.
function runTick(): void {
  if (ticking) return;
  const p = tick().finally(() => {
    if (currentTick === p) currentTick = undefined;
  });
  currentTick = p;
}

/** Begin contending for leadership. Redis mode only. */
export async function start(t: LeaderTransitions): Promise<void> {
  if (timer) return;
  transitions = t;
  client = await GetClient();
  // Kick off an immediate acquisition attempt, but do NOT await it: a slow
  // promotion (e.g. a slow trigger activate) must not block module startup.
  // The interval continues contending.
  runTick();
  timer = setInterval(runTick, TICK_MS);
}

/** Stop contending and release the lock if we hold it (graceful handoff). */
export async function stop(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  // Let an in-flight tick finish so release() can't race it — but cap the wait
  // so a wedged tick can't hang shutdown forever.
  if (currentTick) {
    let graceTimer: NodeJS.Timeout | undefined;
    const grace = new Promise<void>((resolve) => {
      graceTimer = setTimeout(resolve, SHUTDOWN_GRACE_MS);
      graceTimer.unref?.();
    });
    await Promise.race([currentTick, grace]);
    if (graceTimer) clearTimeout(graceTimer);
  }
  if (holdsLock) {
    await release();
  }
  holdsLock = false;
  ticking = false; // reset in case a future start() reuses this module instance
  client = undefined;
  transitions = undefined;
}
