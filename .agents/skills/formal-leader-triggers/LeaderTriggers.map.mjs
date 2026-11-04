/**
 * Reader's view of LeaderTriggers.tla for /statechart: one region for the
 * leader key in Redis and one per instance.
 */

/**
 * The variables of LeaderTriggers.tla this view reads, as /statechart passes
 * them: a function of instances is an object keyed by instance name.
 * @typedef {object} Vars
 * @property {number} now
 * @property {string} owner
 * @property {number} expires
 * @property {Record<string, boolean>} holds
 * @property {Record<string, boolean>} armed
 * @property {Record<string, string>} life
 */

/** @param {Vars} v */
function key(v) {
  if (v.owner === "none") return "Free";
  return v.expires <= v.now ? `Expired, last held by ${v.owner}` : `Held by ${v.owner}`;
}

/**
 * @param {Vars} v
 * @param {string} i
 */
function instance(v, i) {
  const stopped = v.life[i] === "stopped" ? "Stopped" : v.life[i] === "stopping" ? "Stopping" : "";
  const belief = v.holds[i] ? "believes it leads" : "follower";
  const triggers = v.armed[i] ? "triggers armed" : "triggers off";
  return [stopped, belief, triggers].filter(Boolean).join(", ");
}

/**
 * One region for the key, one per instance.
 * @param {Vars} v
 * @returns {Record<string, string>}
 */
export function state(v) {
  /** @type {Record<string, string>} */
  const regions = { Key: key(v) };
  for (const i of Object.keys(v.holds)) regions[`Instance ${i}`] = instance(v, i);
  return regions;
}

const STEPS = new Map([
  ["RunTick", "the leader tick sends its command"],
  ["RenewReply", "Redis answers the renew"],
  ["SetReply", "Redis answers SET NX"],
  ["TickDone", "the tick finishes"],
  ["ReconcileRead", "a reconcile reads leadership"],
  ["ReconcileApply", "the reconcile arms or disarms"],
  ["External", "a peer's edit queues a reconcile"],
  ["StopBegin", "destroy() starts"],
  ["StopWait", "stop() stops waiting for the tick"],
  ["StopRelease", "stop() releases the key"],
  ["StopBus", "the bus closes"],
  ["StopDeactivate", "the handles are torn down"],
  ["Tick", "ten seconds pass"],
]);

/**
 * The arrow label of one TLC step; `Settled` changes nothing and is hidden.
 * @param {string} action
 */
export function step(action) {
  return action === "Settled" ? null : (STEPS.get(action) ?? null);
}

export const title = "Leader election and singleton triggers of dms-automation";
