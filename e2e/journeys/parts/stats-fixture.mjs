import { randomUUID } from "node:crypto";
import { auto, text } from "../../auto.mjs";
import { action, chain, createEnabled, createProcedure, graph, manualLog, tedge, trigger } from "../../procs.mjs";
import { patchProcedure, pause, unarmed, withDatabase } from "./overview-kit.mjs";
import { insertRuns, runDocument } from "./runs-common.mjs";

/**
 * @typedef {import("../../auto.mjs").Ctx} Ctx
 * @typedef {import("../../auto.mjs").Row} Row
 * @typedef {{ p: string, at: number, status?: string, kind?: string, dur?: number, error?: string, node?: string, name?: string }} RunSpec
 */

const m = (/** @type {number} */ n) => n * 60_000;
const h = (/** @type {number} */ n) => n * 3_600_000;
const d = (/** @type {number} */ n) => n * 86_400_000;

/**
 * Every window the journey asks, as offsets from the current hour `H`, so the edges sit on runs the fixture stores.
 *
 * @param {number} hour The current hour, in epoch milliseconds
 * @returns {Record<string, { from: number, to: number, compareFrom?: number, compareTo?: number }>} The windows by name
 */
export function windowsOf(hour) {
  const aFrom = hour - h(171);
  const bFrom = hour - h(30) + m(25);
  const cFrom = hour - h(60);
  return {
    weekCompared: { from: aFrom, to: hour - h(3), compareFrom: aFrom - d(7), compareTo: aFrom },
    hoursCompared: { from: bFrom, to: bFrom + h(26), compareFrom: bFrom - h(26), compareTo: bFrom },
    twoDays: { from: cFrom, to: hour - h(12), compareFrom: hour - h(108), compareTo: cFrom },
    twoDaysAndAMillisecond: { from: cFrom - 1, to: hour - h(12), compareFrom: hour - h(108), compareTo: cFrom - 1 },
    olderThanRetention: { from: hour - d(40), to: hour - d(5), compareFrom: hour - d(75), compareTo: hour - d(40) },
    comparedBeforeLookback: { from: hour - d(10), to: hour - d(1), compareFrom: hour - d(19), compareTo: hour - d(10) },
    comparedByATestRun: { from: hour - d(30), to: hour - d(25), compareFrom: hour - d(40), compareTo: hour - d(30) },
    mismatchedCompared: { from: hour - h(50), to: hour - h(10), compareFrom: hour - d(26), compareTo: hour - d(23) },
    calm: { from: hour - h(285), to: hour - h(255), compareFrom: hour - h(330), compareTo: hour - h(290) },
    empty: { from: hour - d(200), to: hour - d(190) },
  };
}

/**
 * Creates the procedures: enabled, paused, failing, degraded, healthy, a draft, one that cannot arm and one deleted.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<Record<string, string>>} Their ids by key, the deleted one included
 */
async function createProcedures(ctx) {
  const unique = (/** @type {string} */ name) => ctx.unique(name);
  /** @type {Record<string, string>} */
  const ids = {};
  const enabled = async (/** @type {string} */ key, /** @type {string} */ name, /** @type {ReturnType<typeof chain>} */ g) => {
    ids[key] = (await createEnabled(ctx, { name: unique(name), graph: g })).id;
  };
  const failNode = (/** @type {string} */ id, /** @type {string} */ label) => {
    const node = action(id, "verify.fail", { message: "x" });
    if (label) node.label = label;
    return node;
  };
  await enabled("steady", "Steady", manualLog("fine"));
  await enabled("webhookOk", "Webhook ok", chain([trigger("t", "webhook", { path: `/stats/${randomUUID().slice(0, 8)}`, method: "PUT" }), action("log", "log.message", { message: "x" })]));
  await enabled(
    "twoTriggers",
    "Two triggers",
    graph(
      [trigger("t1", "webhook", { path: `/stats/${randomUUID().slice(0, 8)}` }), trigger("t2"), action("log", "log.message", { message: "x" })],
      [tedge("t1", "log"), tedge("t2", "log")],
    ),
  );
  await enabled("longStreak", "Long streak", chain([trigger("t"), failNode("boom", "Charge card")]));
  await enabled("shortFail", "Short failure", chain([trigger("t"), failNode("f", "")]));
  await enabled("tieFail", "Tied failure", chain([trigger("t"), failNode("step-b", "Notify team")]));
  await enabled("degradedRecent", "Degraded recently", manualLog("fine"));
  await enabled("healthyOldFail", "Old failures", manualLog("fine"));
  await enabled("pausedProc", "Paused one", manualLog("fine"));
  await enabled("noRuns", "No production run", manualLog("fine"));
  await enabled("cut", "Cut by the lookback", chain([trigger("t"), failNode("f", "")]));
  await enabled("removed", "Removed later", manualLog("fine"));
  await enabled("dismissedHidden", "Dismissed", manualLog("fine"));
  await enabled("dismissedBack", "Dismissed then failed", manualLog("fine"));
  ids.neverEnabled = await createProcedure(ctx, { name: unique("Never enabled with runs"), graph: manualLog("fine") });
  ids.draft = await createProcedure(ctx, { name: unique("Draft"), graph: manualLog("fine") });
  ids.noTrigger = await createProcedure(ctx, { name: unique("No trigger"), graph: chain([action("a", "log.message", { message: "x" })]) });
  ids.unarmed = await unarmed(ctx, unique("Cannot arm"));
  await pause(ctx, ids.pausedProc ?? "");
  return ids;
}

/** @type {RunSpec[]} */
const EDGES = [
  { p: "steady", at: -h(171), dur: 40 },
  { p: "degradedRecent", at: -h(171), status: "failed", dur: 33, error: "edge of the week", node: "gone" },
  { p: "steady", at: -h(171) - 1, dur: 41 },
  { p: "steady", at: -h(339), dur: 9 },
  { p: "steady", at: -h(339) - 1, dur: 8 },
  { p: "webhookOk", at: -h(3), dur: 55 },
  { p: "webhookOk", at: -h(3) + 1, dur: 20 },
  { p: "steady", at: -h(30) + m(25), dur: 70 },
  { p: "degradedRecent", at: -h(30) + m(25) - 1, status: "failed", dur: 31 },
  { p: "twoTriggers", at: -h(4) + m(25), dur: 90 },
  { p: "steady", at: -h(4) + m(25) + 1, dur: 15 },
  { p: "twoTriggers", at: -h(56) + m(25), dur: 80 },
  { p: "twoTriggers", at: -h(56) + m(25) - 1, dur: 81 },
  { p: "steady", at: -h(20), dur: 25 },
  { p: "degradedRecent", at: -h(20) - 1, status: "failed", dur: 35, error: "on the hour", node: "gone" },
  { p: "webhookOk", at: -h(20) + 1, dur: 26 },
  { p: "webhookOk", at: -h(60), dur: 44 },
  { p: "twoTriggers", at: -h(60) - 1, dur: 45 },
  { p: "steady", at: -h(12), dur: 46 },
  { p: "steady", at: -h(12) + 1, dur: 47 },
  { p: "twoTriggers", at: -h(108), dur: 48 },
  { p: "twoTriggers", at: -h(108) - 1, dur: 49 },
];

/** @type {RunSpec[]} */
const RECENT = [
  { p: "longStreak", at: -m(15), status: "failed", dur: 44, error: "charge declined #latest", node: "boom" },
  { p: "steady", at: -m(25), dur: 0 },
  { p: "steady", at: -m(35), dur: 999 },
  { p: "steady", at: -m(35), dur: 1000 },
  { p: "ghost", at: -m(35), dur: 2549, name: "" },
  { p: "tieFail", at: -m(35), status: "failed", dur: 12, error: "mail refused", node: "step-b" },
  { p: "ghost", at: -m(45), status: "failed", dur: 61, error: "ghost boom", node: "x1", name: "Ghost procedure" },
  { p: "shortFail", at: -m(50), status: "failed", dur: 23, error: "disk full", node: "f" },
  { p: "webhookOk", at: -m(60), kind: "rerun", dur: 17 },
  { p: "twoTriggers", at: -m(70), dur: 19 },
  { p: "twoTriggers", at: -m(80), dur: 21 },
  { p: "twoTriggers", at: -m(80), dur: 22 },
  { p: "degradedRecent", at: -h(2), dur: 18 },
  { p: "shortFail", at: -m(150), status: "failed", dur: 24, error: "disk full earlier", node: "f" },
  { p: "tieFail", at: -h(4), status: "failed", dur: 13, error: "mail refused earlier", node: "step-b" },
  { p: "dismissedBack", at: -h(4), dur: 14 },
  { p: "dismissedHidden", at: -h(3), dur: 15 },
  { p: "pausedProc", at: -h(5), dur: 16 },
  { p: "removed", at: -h(6), dur: 17 },
  { p: "removed", at: -h(26), status: "failed", dur: 18, error: "gone soon", node: "t" },
  { p: "neverEnabled", at: -h(9), dur: 11 },
  { p: "ghost", at: -h(9), status: "failed", dur: 70, error: "ghost boom earlier", node: "x1", name: "Ghost procedure" },
  { p: "dismissedBack", at: -h(10), status: "failed", dur: 50, error: "back again", node: "log" },
  { p: "pausedProc", at: -h(20), status: "failed", dur: 90, error: "before the pause", node: "log" },
  { p: "dismissedHidden", at: -h(48), status: "failed", dur: 52, error: "dismissed failure", node: "log" },
  { p: "dismissedHidden", at: -h(30), dur: 53 },
  { p: "dismissedBack", at: -h(48) - m(1), dur: 54 },
  { p: "degradedRecent", at: -h(40), dur: 55 },
  { p: "degradedRecent", at: -h(100), dur: 56 },
  { p: "degradedRecent", at: -h(150), dur: 57 },
  { p: "degradedRecent", at: -h(200), dur: 58 },
  { p: "pausedProc", at: -h(60), dur: 59 },
];

/** @type {RunSpec[]} */
const OLD = [
  { p: "healthyOldFail", at: -h(192), status: "failed", dur: 61, error: "old failure", node: "log" },
  { p: "healthyOldFail", at: -h(191), status: "failed", dur: 62, error: "old failure too", node: "log" },
  { p: "healthyOldFail", at: -h(150), dur: 63 },
  { p: "healthyOldFail", at: -h(100), dur: 64 },
  { p: "healthyOldFail", at: -h(30), dur: 65 },
  { p: "longStreak", at: -h(288), dur: 66 },
  { p: "cut", at: -d(34), status: "failed", dur: 67, error: "before the lookback", node: "f" },
  { p: "cut", at: -d(33) - h(12), status: "failed", dur: 68, error: "before the lookback too", node: "f" },
  { p: "cut", at: -d(20), status: "failed", dur: 69, error: "inside the lookback", node: "f" },
  { p: "cut", at: -d(10), status: "failed", dur: 70, error: "inside the lookback too", node: "f" },
  { p: "cut", at: -d(2), status: "failed", dur: 71, error: "the last", node: "f" },
  { p: "steady", at: -d(34) - h(3), dur: 72 },
  { p: "steady", at: -d(22), dur: 73 },
  { p: "webhookOk", at: -d(21), dur: 74 },
  { p: "twoTriggers", at: -d(27), dur: 75 },
  { p: "shortFail", at: -h(30), dur: 76 },
  { p: "tieFail", at: -h(31), dur: 77 },
];

/** @type {RunSpec[]} */
const TESTS = [
  { p: "steady", at: -m(10), status: "failed", dur: 5, error: "a test", node: "log", kind: "test" },
  { p: "noRuns", at: -m(40), status: "failed", dur: 6, error: "a test", node: "log", kind: "test" },
  { p: "noRuns", at: -h(1), dur: 7, kind: "test" },
  { p: "healthyOldFail", at: -m(5), status: "failed", dur: 8, error: "a test", node: "log", kind: "test" },
  { p: "steady", at: -h(171), status: "failed", dur: 9, error: "a test on the edge", node: "log", kind: "test" },
  { p: "steady", at: -h(10), status: "failed", dur: 4, error: "a test", node: "log", kind: "test" },
  { p: "webhookOk", at: -d(45), dur: 3, kind: "test" },
  { p: "pausedProc", at: -m(20), dur: 2, kind: "test" },
];

/**
 * The runs every procedure has over the weeks: a run every few hours, one in seven a rerun.
 *
 * @returns {RunSpec[]} The runs
 */
function bulkRuns() {
  /** @type {RunSpec[]} */
  const runs = [];
  for (let i = 0; i <= 65; i += 1) runs.push({ p: "steady", at: -h(330) + i * h(5) + m(7), kind: i % 7 === 3 ? "rerun" : "run", dur: 10 + ((i * 37) % 190) });
  for (let i = 0; i <= 110; i += 1) runs.push({ p: "twoTriggers", at: -h(340) + i * h(3) + m(11), dur: 20 + ((i * 53) % 300) });
  for (let i = 0; i <= 9; i += 1) runs.push({ p: "webhookOk", at: -h(250) + i * h(23) + m(3), dur: 30 + i * 11 });
  for (let i = 0; i <= 14; i += 1) runs.push({ p: "longStreak", at: -h(216) + i * h(11), status: "failed", dur: 30 + i, error: `charge declined #${i}`, node: "boom" });
  return runs;
}

/**
 * Every run of the fixture, as specs.
 *
 * @returns {RunSpec[]} The runs
 */
function runSpecs() {
  return [...EDGES, ...RECENT, ...OLD, ...TESTS, ...bulkRuns()];
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<Record<string, string>>} The name of every stored procedure by id
 */
async function procedureNames(ctx) {
  const stored = await withDatabase(ctx, (database) => database.collection("dms_automation__procedures").find({}).toArray());
  return Object.fromEntries(stored.map((row) => [text(row, "_id"), text(row, "name")]));
}

/**
 * Seeds the fixture of the stats equivalence journey: procedures through the API, then run documents straight into MongoDB at fixed offsets from the current hour.
 *
 * @param {Ctx} ctx The journey
 * @param {number} hour The current hour, in epoch milliseconds
 * @returns {Promise<Record<string, string>>} The id of every procedure by key, the deleted one included
 */
export async function seedFixture(ctx, hour) {
  const ids = await createProcedures(ctx);
  ids.ghost = randomUUID();
  const names = await procedureNames(ctx);
  const docs = runSpecs().map((spec) => {
    const procedureId = ids[spec.p] ?? "";
    const rerun = spec.kind === "rerun";
    return runDocument({
      procedureId,
      procedureName: spec.name ?? names[procedureId] ?? "",
      startedAt: new Date(hour + spec.at),
      durationMs: spec.dur ?? 5,
      status: spec.status ?? "ok",
      kind: spec.kind ?? "run",
      errorMessage: spec.status === "failed" ? spec.error : undefined,
      steps: spec.node && spec.status === "failed" ? [{ id: spec.node, durationMs: spec.dur ?? 5, error: spec.error ?? "failed" }] : undefined,
      rerunOf: rerun ? randomUUID() : undefined,
    });
  });
  await insertRuns(ctx, docs);
  await patchProcedure(ctx, ids.dismissedBack ?? "", { attentionDismissedAt: new Date(hour - h(48)) });
  await patchProcedure(ctx, ids.dismissedHidden ?? "", { attentionDismissedAt: new Date(hour - h(48)) });
  await auto(ctx, "delete the removed procedure", "DELETE", `/procedures/${ids.removed}`);
  return ids;
}
