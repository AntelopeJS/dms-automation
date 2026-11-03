import { auto, check, fixture, isRow, isText, list, parseJson, pick, raw, same, text } from "../../auto.mjs";
import { EMPTY_GRAPH, notFound, procedureCount, summaryOf } from "./procedures-common.mjs";
import { action, chain, clearLedger, createProcedure, graph, ledger, manualLog, runNow, runOf, tedge, trigger, until } from "../../procs.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/** @param {Ctx} ctx @param {string} id */
const confirmOf = async (ctx, id) => (await auto(ctx, "delete confirmation", "GET", `/procedures/${id}/delete-confirm`)).body;

/** @param {Ctx} ctx */
export async function deleteConfirmation(ctx) {
  const draft = await createProcedure(ctx, { name: "Draft é", graph: manualLog("x") });
  const hook = await createProcedure(ctx, { name: "Hook 日本", graph: chain([trigger("t", "webhook", { path: "/hooks/confirm", method: "PUT" }), action("l", "log.message", { message: "x" })]) });
  const cron = await createProcedure(ctx, { name: "Cron", graph: chain([trigger("t", "schedule.cron", { cron: "0 9 * * 1" }), action("l", "log.message", { message: "x" })]) });
  const busy = await createProcedure(ctx, { name: "Busy", graph: manualLog("x") });
  for (const id of [hook, cron, busy]) await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
  await runNow(ctx, busy, {});
  await runNow(ctx, busy, {});
  await runNow(ctx, busy, {});
  await auto(ctx, "a test run does not count", "POST", `/procedures/${busy}/test`, { body: { graph: manualLog("t") } });
  const [d, h, c, b] = [await confirmOf(ctx, draft), await confirmOf(ctx, hook), await confirmOf(ctx, cron), await confirmOf(ctx, busy)];
  const missing = await auto(ctx, "confirmation of an unknown procedure", "GET", "/procedures/nope/delete-confirm");
  const deleteDialog = (/** @type {string} */ description, /** @type {unknown} */ params, /** @type {unknown} */ impact, /** @type {string} [confirmText] */ confirmText) => {
    const dialog = { title: "$dms_automation.procedures.deleteTitle", description, params, icon: "i-ph-trash", color: "error", confirmLabel: "$dms_automation.procedures.deleteConfirm", impact };
    return confirmText === undefined ? dialog : { ...dialog, confirmText };
  };
  await ctx.verify("the delete dialog is worded for the procedure", [
    same("a disabled draft: says the graph goes for good, no name to type, no impact", d, deleteDialog("$dms_automation.api.deleteDescription", { name: "Draft é", count: 0 }, [])),
    same("an enabled webhook procedure: Pause suggested, name to type, the webhook that stops", h, deleteDialog("$dms_automation.api.deleteEnabledDescription", { name: "Hook 日本", count: 0 }, [{ icon: "i-ph-webhooks-logo", label: "$dms_automation.api.deleteImpact.webhook", count: "PUT /hooks/confirm" }], "Hook 日本")),
    same("an enabled schedule procedure: the schedule that stops, worded by weekday", [list(c, "impact"), pick(c, "params")], [[{ icon: "i-ph-clock", label: "$dms_automation.procedures.deleteImpact.schedule", count: "$dms_automation.api.weekly.mon" }], { name: "Cron", count: 0, time: `09:00 (${Intl.DateTimeFormat().resolvedOptions().timeZone})` }]),
    same("the count is the production runs of this week; a test run is left out", [pick(b, "params", "count"), isRow(b) ? b.confirmText : null], [3, "Busy"]),
    ...notFound(missing, "unknown procedure", "nope"),
  ]);
}

/** @param {Ctx} ctx */
export async function deleteTakesTheGraphAndKeepsTheRuns(ctx) {
  await clearLedger(ctx);
  const event = await createProcedure(ctx, { name: "Event driven é", graph: chain([trigger("t", "verify.event", { topic: "delete-me" }), action("l", "log.message", { message: "ran for delete" })]) });
  const hook = await createProcedure(ctx, { name: "Hooked", graph: chain([trigger("t", "webhook", { path: "/hooks/delete-me", method: "POST" }), action("l", "log.message", { message: "x" })]) });
  const bystander = await createProcedure(ctx, { name: "Bystander", graph: manualLog("untouched") });
  for (const id of [event, hook, bystander]) await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
  await fixture(ctx, "fire the event", "POST", "/emit", { topic: "delete-me", payload: { value: "kept ü" } });
  const [run] = await until(async () => (await auto(ctx, "runs of the event procedure", "GET", `/procedures/${event}/runs`)).body, (rows) => list(rows).length > 0).then(list);
  const runId = text(run, "_id");
  const hooked = await raw(ctx, "call the webhook before the delete", { path: "/hooks/delete-me", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) });
  const bystanderRun = await runNow(ctx, bystander, {});
  const before = await procedureCount(ctx);
  const exportBefore = (await auto(ctx, "export before", "GET", `/procedures/${event}/export`)).body;
  const del = await auto(ctx, "delete the event procedure", "DELETE", `/procedures/${event}`);
  const delHook = await auto(ctx, "delete the webhook procedure", "DELETE", `/procedures/${hook}`);
  const again = await auto(ctx, "delete it twice", "DELETE", `/procedures/${event}`);
  const gone = await Promise.all([auto(ctx, "read", "GET", `/procedures/${event}`), auto(ctx, "export", "GET", `/procedures/${event}/export`), auto(ctx, "confirm", "GET", `/procedures/${event}/delete-confirm`), auto(ctx, "enabled", "PUT", `/procedures/${event}/enabled`, { body: { enabled: true } }), auto(ctx, "triggers", "GET", `/procedures/${event}/triggers`)]);
  const afterCall = await raw(ctx, "call the webhook after the delete", { path: "/hooks/delete-me", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) });
  const emitted = await fixture(ctx, "fire the event again", "POST", "/emit", { topic: "delete-me", payload: { value: "after" } });
  const kept = await runOf(ctx, runId);
  const logs = await auto(ctx, "the kept run's logs", "GET", `/runs/${runId}/logs`);
  const table = await auto(ctx, "run history", "GET", "/tables/runs/list?limit=50");
  const summary = await auto(ctx, "summary", "GET", "/procedures/summary");
  const after = await ledger(ctx);
  const rowOfRun = list(table.body, "results").find((r) => r._id === runId);
  await ctx.verify("delete", [
    same("the hook answered before the delete", hooked.status !== 404, true),
    same("delete answers the id", [del.status, del.body], [200, { _id: event }]),
    same("the webhook procedure is deleted too", [delHook.status, delHook.body], [200, { _id: hook }]),
    same("a second delete is a 404 not found", [again.status, text(again.body, "error"), text(again.body, "message")], [404, `procedure "${event}" not found`, "$dms_automation.api.notFound"]),
    same("every read of the deleted procedure is a 404", gone.map((a) => a.status), [404, 404, 404, 404, 404]),
    same("the list lost exactly the two", [before, await procedureCount(ctx)], [3, 1]),
    same("the summary keeps only the bystander", list(summary.body).map((r) => r.name), ["Bystander"]),
    same("the bystander is untouched and runs", [(await summaryOf(ctx, bystander)).status, bystanderRun.status], ["healthy", "ok"]),
    same("the webhook no longer answers", afterCall.status, 404),
    same("the event trigger was deactivated with the procedure", [after.entries.filter((e) => e.kind === "deactivate" && e.topic === "delete-me").length >= 1, emitted.body && pick(emitted.body, "emitted")], [true, 0]),
    same("the run it made stays and opens", [kept.status, text(kept, "procedureName"), text(kept, "procedureId")], ["ok", "Event driven é", event]),
    check("the run's logs stay", list(logs.body, "entries").map((e) => e.message).includes("ran for delete"), list(logs.body, "entries").map((e) => e.message)),
    same("the run is still in the run history", [rowOfRun?.status, rowOfRun?.procedureName], ["ok", "Event driven é"]),
    same("the run history keeps the webhook run too", list(table.body, "results").filter((r) => r.procedureName === "Hooked").length >= 1, hooked.status < 400),
    same("the exported copy taken before the delete still has the graph, nothing else keeps it", [isRow(exportBefore) ? exportBefore.name : null], ["Event driven é"]),
  ]);
}

/** Run now as the dashboard sends it when no payload is given: an empty body. */
async function runBare(/** @type {Ctx} */ ctx, /** @type {string} */ id) {
  const answer = await auto(ctx, "Run now with no payload", "POST", `/procedures/${id}/run-now`, { body: {} });
  return { runId: text(answer.body, "runId"), status: text(answer.body, "status") };
}

/** @param {Ctx} ctx */
export async function lastPayload(ctx) {
  const id = await createProcedure(ctx, { name: "Payloads", graph: graph([trigger("a", "verify.event", { topic: "payload-a" }), trigger("b", "verify.event", { topic: "payload-b" }), action("l", "verify.echo", { value: "x" })], [tedge("a", "l"), tedge("b", "l")]) });
  await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
  const none = await auto(ctx, "last payload before any call", "GET", `/procedures/${id}/last-payload`);
  const neverCalled = await runBare(ctx, id);
  const neverRun = await runOf(ctx, neverCalled.runId);
  await fixture(ctx, "emit to a", "POST", "/emit", { topic: "payload-a", payload: { who: "a", text: "é 日本" } });
  await until(async () => (await auto(ctx, "runs", "GET", `/procedures/${id}/runs`)).body, (rows) => list(rows).length >= 2);
  await fixture(ctx, "emit to b", "POST", "/emit", { topic: "payload-b", payload: { who: "b" } });
  await until(async () => (await auto(ctx, "runs", "GET", `/procedures/${id}/runs`)).body, (rows) => list(rows).length >= 3);
  const test = await auto(ctx, "test run with its own payload", "POST", `/procedures/${id}/test`, { body: { graph: manualLog("t"), payload: { who: "test" } } });
  const last = await auto(ctx, "last payload", "GET", `/procedures/${id}/last-payload`);
  const lastA = await auto(ctx, "last payload of trigger a", "GET", `/procedures/${id}/last-payload?triggerNodeId=a`);
  const lastOther = await auto(ctx, "last payload of a trigger that never fired", "GET", `/procedures/${id}/last-payload?triggerNodeId=zzz`);
  const defaulted = await runBare(ctx, id);
  const defaultedRun = await runOf(ctx, defaulted.runId);
  const explicitEmpty = await auto(ctx, "Run now with an explicit empty payload", "POST", `/procedures/${id}/run-now`, { body: { payload: {} } });
  const explicitRun = await runOf(ctx, text(explicitEmpty.body, "runId"));
  const missing = await auto(ctx, "last payload of an unknown procedure", "GET", "/procedures/nope/last-payload");
  const payloadOf = (/** @type {import("../../auto.mjs").Row} */ run) => { const stored = pick(run, "trigger", "payload") ?? pick(run, "triggerPayload"); return isText(stored) ? parseJson(stored) : stored; };
  await ctx.verify("last payload", [
    same("never called: no last payload, not too large", [none.status, none.body], [200, { last: null, tooLarge: false }]),
    same("Run now with no payload and no earlier call runs with an empty payload", payloadOf(neverRun), {}),
    same("the last real call is the newest production run", [pick(last.body, "last", "payload"), pick(last.body, "last", "triggerNodeId")], [{ who: "b" }, "b"]),
    same("the last payload carries the run id and start time", [isText(pick(last.body, "last", "runId")), isText(pick(last.body, "last", "startedAt")), pick(last.body, "tooLarge")], [true, true, false]),
    same("a test run never becomes the default payload", [test.status, pick(last.body, "last", "payload")], [200, { who: "b" }]),
    same("per trigger: the last call of trigger a", [pick(lastA.body, "last", "payload"), pick(lastA.body, "last", "triggerNodeId")], [{ who: "a", text: "é 日本" }, "a"]),
    same("a trigger that never fired has none", lastOther.body, { last: null, tooLarge: false }),
    same("Run now with no payload sends the last real payload", payloadOf(defaultedRun), { who: "b" }),
    same("an explicit empty payload is used as given", payloadOf(explicitRun), {}),
    ...notFound(missing, "unknown procedure", "nope"),
  ]);
}

/** @param {Ctx} ctx */
export async function triggers(ctx) {
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hook = await createProcedure(ctx, { name: "Hook text", graph: chain([trigger("w", "webhook", { path: "/hooks/stripe", method: "POST" }), action("l", "log.message", { message: "x" })]) });
  const delete_ = await createProcedure(ctx, { name: "Delete method", graph: graph([trigger("w", "webhook", { path: "/hooks/del", method: "DELETE" }), trigger("m"), trigger("c", "schedule.cron", { cron: "*/15 * * * *" })]) });
  const none = await createProcedure(ctx, { name: "None", graph: EMPTY_GRAPH });
  const before = Date.now();
  const a = await auto(ctx, "triggers of the webhook procedure", "GET", `/procedures/${hook}/triggers`);
  const b = await auto(ctx, "triggers of the mixed procedure", "GET", `/procedures/${delete_}/triggers`);
  const after = Date.now();
  const empty = await auto(ctx, "triggers of a procedure with none", "GET", `/procedures/${none}/triggers`);
  const missing = await auto(ctx, "triggers of an unknown procedure", "GET", "/procedures/nope/triggers");
  const quarter = 15 * 60_000;
  const next = (/** @type {number} */ t) => new Date((Math.floor(t / quarter) + 1) * quarter).toISOString();
  const trig = list(b.body, "triggers");
  await ctx.verify("the saved triggers", [
    same("a webhook: type, method, path, text, no next time", list(a.body, "triggers"), [{ nodeId: "w", typeId: "webhook", typeName: "$dms_automation.types.webhook.name", path: "/hooks/stripe", method: "POST", text: "POST /hooks/stripe", nextAt: null }]),
    same("triggers come in graph order", trig.map((t) => t.nodeId), ["w", "m", "c"]),
    same("a DELETE webhook reads DELETE /path", trig[0]?.text, "DELETE /hooks/del"),
    same("a manual trigger is named by its type, no next time", [trig[1]?.text, trig[1]?.nextAt], ["$dms_automation.types.manual.name", null]),
    same("a schedule says Every 15 minutes", [trig[2]?.cron, trig[2]?.text], ["*/15 * * * *", { key: "dms_automation.cron.everyMinutes", params: { n: "15" } }]),
    same("a schedule names the zone it fires in", trig[2]?.timeZone, tzName),
    check("a schedule's next time is the next quarter hour", [next(before), next(after)].includes(String(trig[2]?.nextAt)), trig[2]?.nextAt),
    same("no trigger: an empty list", [empty.status, empty.body], [200, { triggers: [] }]),
    ...notFound(missing, "unknown procedure", "nope"),
  ]);
}

/** @param {Ctx} ctx */
export async function validate(ctx) {
  const missing = chain([trigger("t"), action("req", "http.request", {})]);
  const send = (/** @type {string} */ label, /** @type {unknown} */ body) => auto(ctx, label, "POST", "/procedures/validate", { body });
  const draft = await send("validate a draft", { graph: missing });
  const enabling = await send("validate as an enabled one", { graph: missing, enabled: true });
  const none = await send("validate no graph", { enabled: true });
  const withTriggers = await send("validate with triggers", { graph: chain([trigger("t", "schedule.cron", { cron: "0 8 * * 1-5" }), action("l", "log.message", { message: "x" })]) });
  const first = await createProcedure(ctx, { name: "Taken name", graph: EMPTY_GRAPH });
  const named = await send("validate under a taken name", { graph: EMPTY_GRAPH, name: "taken name" });
  const own = await send("validate under its own name", { graph: EMPTY_GRAPH, name: "Taken name", procedureId: first });
  const summarize = (/** @type {import("../../auto.mjs").Answer} */ a) => list(a.body, "issues").map((i) => [i.severity, i.code, i.message, i.nodeId]);
  await ctx.verify("the Problems of a draft", [
    same("a missing setting on a draft is a warning", summarize(draft), [["warning", "missingField", "URL is empty", "req"]]),
    same("the same graph as an enabled procedure is an error", summarize(enabling), [["error", "missingField", "URL is empty", "req"]]),
    same("answers for a graph with no trigger when enabling", [list(enabling.body, "issues").some((i) => i.code === "noTrigger"), pick(enabling.body, "triggers")], [false, [{ nodeId: "t", typeId: "manual", typeName: "$dms_automation.types.manual.name", text: "$dms_automation.types.manual.name" }]]),
    same("no graph: 400", none.status, 400),
    same("the triggers come with their text", list(withTriggers.body, "triggers").map((t) => [t.typeId, t.cron, pick(t, "text", "key"), pick(t, "text", "params", "time")]), [["schedule.cron", "0 8 * * 1-5", "dms_automation.cron.weekdays", `08:00 (${Intl.DateTimeFormat().resolvedOptions().timeZone})`]]),
    same("a taken name is a warning with the name", summarize(named), [["warning", "nameTaken", 'another procedure is already named "taken name"', undefined]]),
    same("the procedure's own name is no warning", summarize(own), []),
  ]);
}

/** @param {Ctx} ctx */
export async function listAndSummary(ctx) {
  const ids = [];
  for (let n = 0; n < 23; n += 1) ids.push(await createProcedure(ctx, { name: `P${String(n).padStart(2, "0")} é`, graph: EMPTY_GRAPH }));
  const page = async (/** @type {string} */ query) => (await auto(ctx, `list ${query}`, "GET", `/procedures${query}`)).body;
  const first = await page("");
  const second = await page("?page=1&limit=10");
  const third = await page("?page=2&limit=10");
  const big = await page("?limit=500");
  const bad = await Promise.all(["?page=-1", "?page=x", "?limit=0", "?limit=-3", "?limit=1.5", "?page=1.5"].map((q) => auto(ctx, `list ${q}`, "GET", `/procedures${q}`)));
  const names = (/** @type {unknown} */ body) => list(body, "results").map((r) => r.name);
  const newestFirst = ids.map((_, i) => `P${String(22 - i).padStart(2, "0")} é`);
  await ctx.verify("the list API pages", [
    same("default page: 20 newest first, total 23, page 0, limit 20", [names(first), pick(first, "total"), pick(first, "page"), pick(first, "limit")], [newestFirst.slice(0, 20), 23, 0, 20]),
    same("page 1 of 10", [names(second), pick(second, "page"), pick(second, "limit")], [newestFirst.slice(10, 20), 1, 10]),
    same("page 2 of 10 is the last three", names(third), newestFirst.slice(20)),
    same("a limit above 200 is read as 200", [names(big).length, pick(big, "limit")], [23, 200]),
    same("every malformed page or limit is a 400 with the invalidPage text", bad.map((a) => [a.status, text(a.body, "message")]), Array(6).fill([400, "$dms_automation.api.invalidPage"])),
    same("each row carries its parsed graph", list(first, "results")[0]?.graph, { nodes: [], triggerEdges: [], dataEdges: [] }),
  ]);
}
