import { auto, list, pick, same, text } from "../../auto.mjs";
import { EMPTY_GRAPH, matches, notFound, procedureOf, refusedBody, summaryOf } from "./procedures-common.mjs";
import { action, chain, createProcedure, graph, manualLog, runNow, trigger } from "../../procs.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

/** @param {Ctx} ctx @param {string} id @param {boolean} enabled @param {Record<string, unknown>} [more] */
function setEnabled(ctx, id, enabled, more = {}) {
  return auto(ctx, enabled ? "enable" : "pause", "PUT", `/procedures/${id}/enabled`, { body: { enabled, ...more } });
}

/** @param {Ctx} ctx */
export async function pauseAndResume(ctx) {
  const id = await createProcedure(ctx, { name: "Pausable", graph: manualLog("pause me") });
  const exportBefore = (await auto(ctx, "export before", "GET", `/procedures/${id}/export`)).body;
  const draftRow = await summaryOf(ctx, id);
  const enabled = await setEnabled(ctx, id, true);
  const afterEnable = await procedureOf(ctx, id);
  const healthy = await summaryOf(ctx, id);
  const paused = await setEnabled(ctx, id, false);
  const afterPause = await procedureOf(ctx, id);
  const pausedRow = await summaryOf(ctx, id);
  const pausedAgain = await setEnabled(ctx, id, false);
  const stillPaused = await procedureOf(ctx, id);
  const resumed = await setEnabled(ctx, id, true);
  const afterResume = await procedureOf(ctx, id);
  const undone = await setEnabled(ctx, id, false, { restorePause: true });
  const afterUndo = await procedureOf(ctx, id);
  const exportAfter = (await auto(ctx, "export after", "GET", `/procedures/${id}/export`)).body;
  await ctx.verify("enable, pause, resume", [
    same("a new draft is a Draft", draftRow.status, "draft"),
    same("enable answers id, enabled and the next revision", [enabled.status, enabled.body], [200, { _id: id, enabled: true, revision: 2 }]),
    same("enabled with no run yet is Healthy with No run yet", [healthy.status, healthy.statusDetail], ["healthy", { text: "$dms_automation.procedures.detail.noRunYet", tone: "muted" }]),
    same("pause answers enabled false and revision 3", [paused.status, paused.body], [200, { _id: id, enabled: false, revision: 3 }]),
    matches("pausing records when", afterPause.pausedAt, ISO),
    same("pausing records who, by display name", afterPause.pausedBy, "Verify Admin"),
    same("a paused procedure reads Paused", pausedRow.status, "paused"),
    same("pausing again is accepted and moves the revision", [pausedAgain.status, pick(pausedAgain.body, "revision")], [200, 4]),
    same("pausing again keeps the first pause time", stillPaused.pausedAt, afterPause.pausedAt),
    same("resume answers enabled true and revision 5", [resumed.status, resumed.body], [200, { _id: id, enabled: true, revision: 5 }]),
    same("a resume leaves the pause's time and author in place", [afterResume.pausedAt, afterResume.pausedBy], [afterPause.pausedAt, afterPause.pausedBy]),
    same("undoing a resume puts the pause back as it was", [undone.status, afterUndo.enabled, afterUndo.pausedAt, afterUndo.pausedBy], [200, false, afterPause.pausedAt, afterPause.pausedBy]),
    same("version stays 1 through every change; revision counts them", [afterEnable.version, afterUndo.version, afterUndo.revision], [1, 1, 6]),
    same("the graph is untouched", exportAfter, exportBefore),
  ]);
  const wrong = await setEnabled(ctx, id, true, {});
  const badType = await auto(ctx, "enabled as text", "PUT", `/procedures/${id}/enabled`, { body: { enabled: "yes" } });
  const noBody = await auto(ctx, "no body", "PUT", `/procedures/${id}/enabled`, {});
  const unknown = await setEnabled(ctx, "nope", true);
  await ctx.verify("odd inputs", [
    same("enabling after the undo works", wrong.status, 200),
    ...refusedBody(badType, "enabled: \"yes\"", ["enabled"]),
    ...refusedBody(noBody, "no body", []),
    ...notFound(unknown, "enabling an unknown procedure", "nope"),
  ]);
}

/** Saves a graph over a procedure as the builder does, on its current revision. */
async function save(/** @type {Ctx} */ ctx, /** @type {string} */ id, /** @type {import("../../procs.mjs").Graph} */ graphOf, enabled = true) {
  const current = await procedureOf(ctx, id);
  return auto(ctx, "save the graph", "PUT", `/procedures/${id}`, { body: { name: current.name, description: current.description, enabled, graph: graphOf, expectedRevision: current.revision } });
}

/** A webhook procedure whose path is exactly the one given (an import would move a taken path). */
async function hookAt(/** @type {Ctx} */ ctx, /** @type {string} */ name, /** @type {string} */ path, method = "POST") {
  const id = await createProcedure(ctx, { name, graph: EMPTY_GRAPH });
  await save(ctx, id, chain([trigger("t", "webhook", { path, method }), action("l", "log.message", { message: "x" })]), false);
  return id;
}

/** @param {Ctx} ctx */
export async function enablingNeedsAGraphThatCanRun(ctx) {
  const empty = await createProcedure(ctx, { name: "No trigger", graph: EMPTY_GRAPH });
  const noTrigger = await setEnabled(ctx, empty, true);
  const missing = await createProcedure(ctx, { name: "Missing setting", graph: chain([trigger("t"), action("req", "http.request", {})]) });
  const missingAnswer = await setEnabled(ctx, missing, true);
  const unknownType = await createProcedure(ctx, { name: "Unknown type", graph: chain([trigger("t"), action("x", "nobody.knows", {})]) });
  const unknownAnswer = await setEnabled(ctx, unknownType, true);
  const first = await hookAt(ctx, "Holds the path", "/hooks/taken");
  const holds = await setEnabled(ctx, first, true);
  const second = await hookAt(ctx, "Wants the path", "/hooks/taken");
  const taken = await setEnabled(ctx, second, true);
  const otherMethod = await hookAt(ctx, "Other method", "/hooks/taken", "GET");
  const otherMethodAnswer = await setEnabled(ctx, otherMethod, true);
  const badPath = await createProcedure(ctx, { name: "Bad path", graph: chain([trigger("t", "webhook", { path: "/api/x", method: "POST" }), action("l", "log.message", { message: "x" })]) });
  const badPathAnswer = await setEnabled(ctx, badPath, true);
  const badCron = await createProcedure(ctx, { name: "Bad cron", graph: chain([trigger("t", "schedule.cron", { cron: "not a cron" }), action("l", "log.message", { message: "x" })]) });
  const badCronAnswer = await setEnabled(ctx, badCron, true);
  const codes = (/** @type {import("../../auto.mjs").Answer} */ a) => list(a.body, "issues").map((i) => [i.severity, i.code]);
  await ctx.verify("refusals to enable", [
    same("no trigger: 400 with the noTrigger text", [noTrigger.status, pick(noTrigger.body, "error"), pick(noTrigger.body, "message"), codes(noTrigger)], [400, "invalid graph", "$dms_automation.api.noTrigger", [["error", "noTrigger"]]]),
    same("the noTrigger issue message", list(noTrigger.body, "issues")[0]?.message, "a procedure needs a trigger before it can be enabled"),
    same("a required setting left empty blocks, worded in English", [missingAnswer.status, pick(missingAnswer.body, "message"), codes(missingAnswer), list(missingAnswer.body, "issues")[0]?.message, list(missingAnswer.body, "issues")[0]?.nodeId], [400, "$dms_automation.api.graphHasErrors", [["error", "missingField"]], "URL is empty", "req"]),
    same("an unknown type blocks", [unknownAnswer.status, codes(unknownAnswer), list(unknownAnswer.body, "issues")[0]?.message], [400, [["error", "unknownType"]], 'action node "x" references unknown type "nobody.knows"']),
    same("the first procedure on a path enables", holds.status, 200),
    same("a second enabled procedure on the same method and path is refused with the path-taken text", [taken.status, pick(taken.body, "message"), codes(taken), list(taken.body, "issues")[0]?.params, list(taken.body, "issues")[0]?.message], [400, "$dms_automation.api.webhookPathTaken", [["error", "webhookPathTaken"]], { method: "POST", path: "/hooks/taken", procedure: "Holds the path" }, 'POST /hooks/taken already answers for the procedure "Holds the path"']),
    same("another method on the same path is allowed", otherMethodAnswer.status, 200),
    same("a reserved path is refused", [badPathAnswer.status, codes(badPathAnswer)], [400, [["error", "webhookPathReserved"]]]),
    same("an invalid cron expression is refused", [badCronAnswer.status, codes(badCronAnswer), list(badCronAnswer.body, "issues")[0]?.message], [400, [["error", "cronInvalid"]], 'invalid cron expression: "not a cron"']),
    same("none of the refused ones is enabled", [(await procedureOf(ctx, empty)).enabled, (await procedureOf(ctx, second)).enabled, (await procedureOf(ctx, badCron)).enabled], [false, false, false]),
  ]);
  const pause = await setEnabled(ctx, missing, false);
  await ctx.verify("pausing a draft with problems is allowed", [same("status", pause.status, 200)]);
}

/** @param {Ctx} ctx */
export async function states(ctx) {
  const fail = (/** @type {string} */ name, /** @type {string} */ message) => createProcedure(ctx, { name, graph: chain([trigger("t"), action("f", "verify.fail", { message })]) });
  const enable = async (/** @type {string} */ id) => (await setEnabled(ctx, id, true)).status;
  const noTrigger = await createProcedure(ctx, { name: "No trigger", graph: EMPTY_GRAPH });
  const neverEnabled = await createProcedure(ctx, { name: "Never enabled", graph: manualLog("x") });
  const ranDisabled = await createProcedure(ctx, { name: "Ran while disabled", graph: manualLog("x") });
  await runNow(ctx, ranDisabled, {});
  const healthy = await createProcedure(ctx, { name: "Healthy one", graph: manualLog("x") });
  await enable(healthy);
  const flaky = await createProcedure(ctx, { name: "Flaky", graph: chain([trigger("t"), action("f", "verify.flaky", { key: ctx.unique("states"), failTimes: 1 })]) });
  await enable(flaky);
  const failingTwice = await fail("Failing twice", "boom é 日本");
  await enable(failingTwice);
  const arm = await createProcedure(ctx, { name: "Cannot arm", graph: graph([trigger("t", "verify.bad-arm")]) });
  const armEnable = await enable(arm);
  const pausedAfterRun = await createProcedure(ctx, { name: "Paused", graph: manualLog("x") });
  await enable(pausedAfterRun);
  await runNow(ctx, pausedAfterRun, {});
  await setEnabled(ctx, pausedAfterRun, false);
  const testTarget = await createProcedure(ctx, { name: "Tested", graph: manualLog("x") });
  await enable(testTarget);
  await runNow(ctx, testTarget, {});
  await runNow(ctx, healthy, {});
  const firstFlaky = await runNow(ctx, flaky, {});
  const secondFlaky = await runNow(ctx, flaky, {});
  await runNow(ctx, failingTwice, {});
  const lastFailing = await runNow(ctx, failingTwice, {});
  const ok3 = [await runNow(ctx, testTarget, {}), await runNow(ctx, testTarget, {})];
  const failedDraftGraph = chain([trigger("t"), action("f", "verify.fail", { message: "test only" })]);
  const testRun = await auto(ctx, "test run of a failing draft on a healthy procedure", "POST", `/procedures/${testTarget}/test`, { body: { graph: failedDraftGraph, confirmRealEffects: true } });
  const found = await Promise.all([noTrigger, neverEnabled, ranDisabled, healthy, flaky, failingTwice, arm, pausedAfterRun, testTarget].map((id) => summaryOf(ctx, id)));
  const rows = { noTrigger: found[0] ?? {}, neverEnabled: found[1] ?? {}, ranDisabled: found[2] ?? {}, healthy: found[3] ?? {}, flaky: found[4] ?? {}, failingTwice: found[5] ?? {}, arm: found[6] ?? {}, paused: found[7] ?? {}, tested: found[8] ?? {} };
  const last = (/** @type {import("../../auto.mjs").Row} */ row) => list(row, "lastRuns").map((r) => r.status);
  await ctx.verify("states in the summary", [
    same("the bad-arm procedure enabled", armEnable, 200),
    same("no trigger: Draft", rows.noTrigger.status, "draft"),
    same("a draft shows No trigger yet as its trigger text", [rows.noTrigger.triggerText, rows.noTrigger.trigger, rows.noTrigger.triggerCount], ["$dms_automation.trigger.none", null, 0]),
    same("never enabled, never ran: Draft", rows.neverEnabled.status, "draft"),
    same("disabled but it ran: Paused", rows.ranDisabled.status, "paused"),
    same("enabled with a success: Healthy, no detail, 100% over its runs", [rows.healthy.status, rows.healthy.statusDetail, rows.healthy.successRate, rows.healthy.runs], ["healthy", null, 1, 1]),
    same("a failure then a success: Degraded", rows.flaky.status, "degraded"),
    same("degraded detail counts failed of runs and gives the last error", rows.flaky.statusDetail, { key: "dms_automation.procedures.detail.degraded", params: { failed: 1, runs: 2, error: "flaky failure 1" } }),
    same("degraded success rate is the share of successes", rows.flaky.successRate, 0.5),
    same("runs of the degraded one, oldest first, newest last", last(rows.flaky), ["failed", "ok"]),
    same("the last run of the degraded one is the success", [rows.flaky.lastRunId, firstFlaky.status, secondFlaky.status], [secondFlaky.runId, "failed", "ok"]),
    same("last failed run: Failing", rows.failingTwice.status, "failing"),
    same("failing detail names the step, the streak and the error", [pick(rows.failingTwice.statusDetail, "key"), pick(rows.failingTwice.statusDetail, "params", "step"), pick(rows.failingTwice.statusDetail, "params", "count"), pick(rows.failingTwice.statusDetail, "params", "error")], ["dms_automation.procedures.detail.failingAt", "Fixture failure", { type: "count", value: 2 }, "boom é 日本"]),
    same("the failed step is named", rows.failingTwice.failedStep, { nodeId: "f", kind: "action", typeName: "Fixture failure" }),
    same("last error is the run's error", rows.failingTwice.lastError, "boom é 日本"),
    same("success 0% when every run failed", [rows.failingTwice.successRate, rows.failingTwice.failed, rows.failingTwice.runs], [0, 2, 2]),
    same("last run of the failing one is the last call", rows.failingTwice.lastRunId, lastFailing.runId),
    same("a trigger that cannot arm: Failing with its reason", [rows.arm.status, pick(rows.arm.statusDetail, "key"), pick(rows.arm.statusDetail, "params", "error", "key"), rows.arm.lastError], ["failing", "dms_automation.procedures.detail.triggerError", "dms_automation.editor.problems.codes.armFailed", "the fixture refuses to arm"]),
    same("paused after it ran: Paused", rows.paused.status, "paused"),
    same("a failed test run never counts: still Healthy with 3 production runs", [rows.tested.status, rows.tested.runs, rows.tested.failed, rows.tested.successRate, ok3.map((r) => r.status), testRun.status], ["healthy", 3, 0, 1, ["ok", "ok"], 200]),
  ]);
  await setEnabled(ctx, arm, false);
  const armPaused = await summaryOf(ctx, arm);
  await ctx.verify("a paused procedure has no trigger problem", [same("state and detail", [armPaused.status, armPaused.statusDetail], ["paused", null])]);
}

/** @param {Ctx} ctx */
export async function lastRunsAndSuccessRate(ctx) {
  const id = await createProcedure(ctx, { name: "Many runs", graph: chain([trigger("t"), action("f", "verify.flaky", { key: ctx.unique("many"), failTimes: 1 })]) });
  await setEnabled(ctx, id, true);
  const runIds = [];
  for (let n = 0; n < 15; n += 1) runIds.push((await runNow(ctx, id, { n })).runId);
  const row = await summaryOf(ctx, id);
  const marks = list(row, "lastRuns");
  const third = await createProcedure(ctx, { name: "Two out of three", graph: chain([trigger("t"), action("f", "verify.flaky", { key: ctx.unique("third"), failTimes: 1 })]) });
  await setEnabled(ctx, third, true);
  await runNow(ctx, third, {});
  await runNow(ctx, third, {});
  await runNow(ctx, third, {});
  const thirdRow = await summaryOf(ctx, third);
  await ctx.verify("the strip and the rate", [
    same("the strip draws the last 12 runs", marks.length, 12),
    same("oldest first, newest last: runs 4 to 15", marks.map((m) => m.runId), runIds.slice(3)),
    same("the first of 15 failed and is not in the strip; all drawn are green", marks.map((m) => m.status), Array(12).fill("ok")),
    same("the row counts every run of the window, not only the strip", [row.runs, row.failed], [15, 1]),
    same("the last run is the newest", row.lastRunId, runIds[14]),
    same("success is the share of successful runs (14 of 15) cut to whole percents", row.successRate, 0.93),
    same("2 of 3 reads 66%, never rounded up", thirdRow.successRate, 0.66),
    matches("each mark carries its start time", marks[0]?.startedAt, /^\d{4}-/),
    same("a successful mark has no error", marks[0]?.errorMessage, null),
  ]);
}

/** @param {Ctx} ctx */
export async function dismissAttention(ctx) {
  const failing = chain([trigger("t"), action("f", "verify.fail", { message: "bad" })]);
  const fine = manualLog("fine");
  const id = await createProcedure(ctx, { name: "Dismissable", graph: failing });
  await setEnabled(ctx, id, true);
  await runNow(ctx, id, {});
  await save(ctx, id, fine);
  await runNow(ctx, id, {});
  const names = async () => list((await auto(ctx, "needs attention", "GET", "/stats/attention")).body, "items").map((i) => `${text(i, "name")}:${text(i, "state")}`);
  const before = await names();
  const dismiss = await auto(ctx, "dismiss", "POST", `/procedures/${id}/dismiss-attention`);
  const dismissed = await procedureOf(ctx, id);
  const hidden = await names();
  const undo = await auto(ctx, "undo the dismiss", "DELETE", `/procedures/${id}/dismiss-attention`);
  const restored = await procedureOf(ctx, id);
  const back = await names();
  await auto(ctx, "dismiss again", "POST", `/procedures/${id}/dismiss-attention`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await save(ctx, id, failing);
  await runNow(ctx, id, {});
  const whileFailing = await names();
  await save(ctx, id, fine);
  await runNow(ctx, id, {});
  const afterNewFailure = await names();
  const unknownPost = await auto(ctx, "dismiss an unknown procedure", "POST", "/procedures/nope/dismiss-attention");
  const unknownDelete = await auto(ctx, "undo for an unknown procedure", "DELETE", "/procedures/nope/dismiss-attention");
  await ctx.verify("dismiss and undo", [
    same("a degraded procedure is in Needs attention", before, ["Dismissable:degraded"]),
    same("dismiss answers the id", [dismiss.status, dismiss.body], [200, { _id: id }]),
    matches("dismiss stamps the time", dismissed.attentionDismissedAt, ISO),
    same("the procedure is gone from Needs attention", hidden, []),
    same("undo answers the id and clears the stamp", [undo.status, undo.body, restored.attentionDismissedAt], [200, { _id: id }, null]),
    same("undo brings it back", back, ["Dismissable:degraded"]),
    same("a failing procedure is listed even when it was dismissed earlier", whileFailing, ["Dismissable:failing"]),
    same("it fails again after the dismissal, then recovers: listed again as degraded", afterNewFailure, ["Dismissable:degraded"]),
    ...notFound(unknownPost, "dismiss of an unknown id", "nope"),
    ...notFound(unknownDelete, "undo of an unknown id", "nope"),
  ]);
}
