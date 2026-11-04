import { auto, check, isRow, list, pick, raw, same, text } from "../../auto.mjs";
import { EMPTY_GRAPH, matches, notFound, procedureOf, refusedBody, summaryOf } from "./procedures-common.mjs";
import { action, chain, createProcedure, manualLog, runNow, trigger, until } from "../../procs.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

/**
 * Saves as the builder does.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @param {Record<string, unknown>} body The fields to send
 * @param {string} [label] The step name
 * @returns {Promise<import("../../auto.mjs").Answer>} The answer
 */
function put(ctx, id, body, label = "save") {
  return auto(ctx, label, "PUT", `/procedures/${id}`, { body });
}

/** @param {Ctx} ctx */
export async function saving(ctx) {
  const id = await createProcedure(ctx, { name: "Saver", description: "first", graph: manualLog("v1") });
  const first = await procedureOf(ctx, id);
  const graphOf = (/** @type {Row} */ row) => {
    const stored = pick(row, "graph");
    return isRow(stored) ? { ...stored, nodes: list(stored, "nodes") } : { nodes: [] };
  };
  const moved = { ...graphOf(first), nodes: graphOf(first).nodes.map((n) => ({ ...n, position: { x: 500, y: 300 } })) };
  const moveAnswer = await put(ctx, id, { name: "Saver", description: "first", enabled: false, graph: moved, expectedRevision: first.revision }, "move the nodes");
  const afterMove = await procedureOf(ctx, id);
  const edited = { ...moved, nodes: moved.nodes.map((n) => (n.typeId === "log.message" ? { ...n, config: { message: "v2" } } : n)) };
  const editAnswer = await put(ctx, id, { name: "Saver", description: "first", enabled: false, graph: edited, expectedRevision: afterMove.revision }, "change a setting");
  const afterEdit = await procedureOf(ctx, id);
  await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
  const run = await runNow(ctx, id, {});
  const renamed = await put(ctx, id, { name: "Saver é 日本 ☕", enabled: true, graph: edited, expectedRevision: (await procedureOf(ctx, id)).revision }, "rename, no description");
  const afterRename = await procedureOf(ctx, id);
  const runRows = await until(async () => (await auto(ctx, "runs of the procedure", "GET", `/procedures/${id}/runs`)).body, (rows) => list(rows).length > 0).then(list);
  const row = await summaryOf(ctx, id);
  const paused = await put(ctx, id, { name: "Saver é 日本 ☕", enabled: false, graph: edited, expectedRevision: afterRename.revision }, "pause by saving");
  const afterPause = await procedureOf(ctx, id);
  const stale = await put(ctx, id, { name: "Late", enabled: false, graph: edited, expectedRevision: afterRename.revision }, "save on an old revision");
  const afterStale = await procedureOf(ctx, id);
  const next = await put(ctx, id, { name: "Saver é 日本 ☕", enabled: false, graph: manualLog("v3"), expectedRevision: afterPause.revision }, "third version");
  const olderRun = await auto(ctx, "the run of version 2", "GET", `/runs/${run.runId}`);
  await ctx.verify("saving", [
    same("a new procedure starts at version 1, revision 1, disabled", [first.version, first.revision, first.enabled, first.description], [1, 1, false, "first"]),
    same("moving nodes answers the next revision and the same version, no issues", [moveAnswer.status, moveAnswer.body], [200, { _id: id, version: 1, revision: 2, issues: [] }]),
    same("a move is read back: positions changed, version still 1", [afterMove.version, afterMove.revision, graphOf(afterMove).nodes.map((n) => n.position)], [1, 2, [{ x: 500, y: 300 }, { x: 500, y: 300 }]]),
    same("changing a setting moves the version on", [editAnswer.status, editAnswer.body], [200, { _id: id, version: 2, revision: 3, issues: [] }]),
    same("the saved graph carries the new setting", graphOf(afterEdit).nodes.map((n) => pick(n, "config", "message") ?? null), [null, "v2"]),
    same("a rename keeps the version and moves the revision", [renamed.status, pick(renamed.body, "version"), pick(renamed.body, "revision")], [200, 2, afterEdit.revision + 2]),
    same("no description sent reads back empty", [afterRename.name, afterRename.description], ["Saver é 日本 ☕", ""]),
    same("a rename renames the runs it already has", runRows.map((r) => r.procedureName), ["Saver é 日本 ☕"]),
    same("and the Procedures list", row.name, "Saver é 日本 ☕"),
    same("the run of the procedure lists newest first with its status", [runRows[0]?.status, runRows[0]?._id], ["ok", run.runId]),
    same("pausing by saving answers 200 and records when and by whom", [paused.status, afterPause.enabled, afterPause.pausedBy], [200, false, "Verify Admin"]),
    matches("pausedAt is a timestamp", afterPause.pausedAt, ISO),
    same("a save on an old revision is a 409 stale with the current revision and version", [stale.status, stale.body], [409, { error: "stale", message: "$dms_automation.api.stale", revision: afterPause.revision, version: 2 }]),
    same("a stale save changes nothing", [afterStale.name, afterStale.revision, afterStale.version], [afterPause.name, afterPause.revision, 2]),
    same("a third version is saved", [next.status, pick(next.body, "version")], [200, 3]),
    same("the run of version 2 is still the run of version 2", pick(olderRun.body, "procedureVersion"), 2),
  ]);
  const base = { name: "Saver", enabled: false, graph: EMPTY_GRAPH, expectedRevision: 1 };
  /** @type {Array<[string, Row, string[]]>} */
  const cases = [
    ["no expectedRevision", { name: "Saver", enabled: false, graph: EMPTY_GRAPH }, ["expectedRevision"]],
    ["expectedRevision 1.5", { ...base, expectedRevision: 1.5 }, ["expectedRevision"]],
    ["expectedRevision as text", { ...base, expectedRevision: "1" }, ["expectedRevision"]],
    ["no enabled", { name: "Saver", graph: EMPTY_GRAPH, expectedRevision: 1 }, ["enabled"]],
    ["enabled as text", { ...base, enabled: "no" }, ["enabled"]],
    ["blank name", { ...base, name: "   " }, ["name"]],
    ["name of 201", { ...base, name: "x".repeat(201) }, ["name"]],
    ["description of 2001", { ...base, description: "d".repeat(2001) }, ["description"]],
    ["graph that is not a graph", { ...base, graph: { nodes: 3 } }, ["graph", "nodes"]],
  ];
  const answers = [];
  for (const [label, body] of cases) answers.push({ label, answer: await put(ctx, id, body, label) });
  const atLimit = await put(ctx, id, { ...base, name: "n".repeat(200), description: "d".repeat(2000), expectedRevision: (await procedureOf(ctx, id)).revision }, "name of 200 and description of 2000");
  const unknown = await put(ctx, "nope", base, "save an unknown procedure");
  const noTrigger = await put(ctx, id, { ...base, enabled: true, expectedRevision: (await procedureOf(ctx, id)).revision }, "enable by saving without a trigger");
  const afterRefused = await procedureOf(ctx, id);
  await ctx.verify("what a save refuses", [
    ...answers.flatMap(({ label, answer }, index) => refusedBody(answer, label, cases[index]?.[2] ?? [])),
    same("a name of 200 and a description of 2000 are accepted", atLimit.status, 200),
    ...notFound(unknown, "a save of an unknown id", "nope"),
    same("enabling by saving a graph without trigger is refused with the noTrigger text", [noTrigger.status, pick(noTrigger.body, "message")], [400, "$dms_automation.api.noTrigger"]),
    same("the refused save left the procedure as it was", [afterRefused.enabled, afterRefused.name.length], [false, 200]),
  ]);
}

/** @param {Ctx} ctx */
export async function wrongMethods(ctx) {
  const id = await createProcedure(ctx, { name: "Methods", graph: chain([trigger("t"), action("l", "log.message", { message: "x" })]) });
  await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
  const before = (await auto(ctx, "export before", "GET", `/procedures/${id}/export`)).body;
  const calls = [
    ["PATCH", `/procedures/${id}`], ["DELETE", "/procedures"], ["PUT", "/procedures"], ["POST", "/procedures/summary"], ["POST", `/procedures/${id}/export`],
    ["GET", `/procedures/${id}/enabled`], ["GET", `/procedures/${id}/run-now`], ["GET", `/procedures/${id}/dismiss-attention`], ["DELETE", `/procedures/${id}/export`],
    ["POST", `/procedures/${id}/last-payload`], ["PUT", `/procedures/${id}/triggers`], ["GET", `/procedures/${id}/duplicate`], ["GET", `/procedures/${id}/unknown`],
    ["OPTIONS", "/procedures"], ["OPTIONS", `/procedures/${id}`], ["PATCH", "/procedures/new"], ["DELETE", `/procedures/${id}/delete-confirm`],
  ];
  const answers = [];
  for (const [method, path] of calls) {
    const body = method === "GET" || method === "DELETE" || method === "OPTIONS" ? undefined : "{}";
    answers.push({ method, path, answer: await raw(ctx, `${method} ${path}`, { path: `/api/automation${path}`, method, as: "admin", headers: body ? { "content-type": "application/json" } : {}, body }) });
  }
  const head = await raw(ctx, "HEAD /procedures", { path: "/api/automation/procedures", method: "HEAD", as: "admin" });
  const newAsGet = await auto(ctx, "GET /procedures/new reads it as an id", "GET", "/procedures/new");
  const validateAsGet = await auto(ctx, "GET /procedures/validate reads it as an id", "GET", "/procedures/validate");
  const trailing = await raw(ctx, "trailing slash", { path: `/api/automation/procedures/${id}/`, as: "admin" });
  const long = "x".repeat(120);
  const longId = await auto(ctx, "an id of 120 characters", "GET", `/procedures/${long}`);
  const unicodeId = await auto(ctx, "an id with CJK", "GET", `/procedures/${encodeURIComponent("日本語")}`);
  const after = (await auto(ctx, "export after", "GET", `/procedures/${id}/export`)).body;
  const state = await procedureOf(ctx, id);
  await ctx.verify("methods the routes do not serve", [
    ...answers.map(({ method, path, answer }) => same(`${method} ${path.replace(id, ":id")} is a plain 404 Not Found`, [answer.status, answer.text], [404, "Not Found"])),
    same("HEAD on the list answers 200 with no body", [head.status, head.text], [200, ""]),
    same("GET /procedures/new is the procedure called new: not found", [newAsGet.status, text(newAsGet.body, "error")], [404, 'procedure "new" not found']),
    same("GET /procedures/validate likewise", [validateAsGet.status, text(validateAsGet.body, "message")], [404, "$dms_automation.api.notFound"]),
    same("a trailing slash reaches the procedure", [trailing.status, text(trailing.json, "name")], [200, "Methods"]),
    ...notFound(longId, "an id of 120 characters", long),
    check("an id with CJK characters is not found, not an error", unicodeId.status === 404, unicodeId.status),
    same("nothing changed: export, enabled and revision", [after, state.enabled, state.revision], [before, true, 2]),
  ]);
}

/** @param {Ctx} ctx */
export async function runsOfAProcedure(ctx) {
  const id = await createProcedure(ctx, { name: "History", graph: manualLog("h") });
  await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
  const other = await createProcedure(ctx, { name: "Other", graph: manualLog("o") });
  await auto(ctx, "enable the other", "PUT", `/procedures/${other}/enabled`, { body: { enabled: true } });
  const none = await auto(ctx, "runs before any run", "GET", `/procedures/${id}/runs`);
  const runIds = [];
  for (const n of [1, 2, 3]) runIds.push((await runNow(ctx, id, { n })).runId);
  await runNow(ctx, other, {});
  const all = list((await auto(ctx, "all runs", "GET", `/procedures/${id}/runs`)).body);
  const small = list((await auto(ctx, "limit 2", "GET", `/procedures/${id}/runs?limit=2`)).body);
  const second = list((await auto(ctx, "page 1, limit 2", "GET", `/procedures/${id}/runs?page=1&limit=2`)).body);
  const bad = [];
  for (const query of ["page=-1", "page=x", "limit=0", "limit=-3", "limit=1.5", "page=1.5"]) bad.push(await auto(ctx, `runs?${query}`, "GET", `/procedures/${id}/runs?${query}`));
  const unknown = await auto(ctx, "runs of an unknown procedure", "GET", "/procedures/nope/runs");
  await ctx.verify("the runs of a procedure", [
    same("no run yet is an empty list", [none.status, none.body], [200, []]),
    same("runs come newest first", all.map((r) => r._id), [...runIds].reverse()),
    same("each row names the procedure, its status, kind and trigger", all.map((r) => [r.procedureName, r.status, r.kind, r.triggerNodeId]), runIds.map(() => ["History", "ok", "run", "t"])),
    check("the other procedure's run is not listed", all.every((r) => r.procedureId === id), all.map((r) => r.procedureId)),
    same("a limit of 2 answers one row more, to tell that a next page exists", small.map((r) => r._id), [...runIds].reverse()),
    same("page 1 of 2 holds what is left", second.map((r) => r._id), [runIds[0]]),
    ...bad.map((answer, index) => same(`a bad page or limit ${index + 1} is the invalidPage 400`, [answer.status, text(answer.body, "message")], [400, "$dms_automation.api.invalidPage"])),
    ...notFound(unknown, "runs of an unknown procedure", "nope"),
  ]);
}
