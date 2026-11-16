import { auto, isRow, isText, list, pick, same, text } from "../../auto.mjs";
import { EMPTY_GRAPH, matches, notFound, procedureCount, procedureOf, refusedBody, summaryOf } from "./procedures-common.mjs";
import { action, data, dedge, tedge, trigger, graph, createProcedure } from "../../procs.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const NODE_ID = /^node_[0-9a-f]{8}$/;

/** @param {Ctx} ctx @param {Record<string, unknown>} body @param {string} [label] */
export function newProcedure(ctx, body, label = "new procedure") {
  return auto(ctx, label, "POST", "/procedures/new", { body });
}

/** @param {Ctx} ctx */
export async function createsADraft(ctx) {
  const manual = await newProcedure(ctx, { name: "  Crème brûlée ☕ 日本  ", trigger: "manual", description: "Dessert 🍮 line one\nline two" });
  const hook = await newProcedure(ctx, { name: "Sync paid invoices", trigger: "webhook" });
  const cron = await newProcedure(ctx, { name: "日本語", trigger: "schedule.cron", description: null });
  const ids = [text(manual.body, "_id"), text(hook.body, "_id"), text(cron.body, "_id")];
  const [m, h, c] = [await procedureOf(ctx, ids[0]), await procedureOf(ctx, ids[1]), await procedureOf(ctx, ids[2])];
  const node = (/** @type {import("../../auto.mjs").Row} */ p) => list(p.graph, "nodes")[0] ?? {};
  await ctx.verify("the three starters", [
    same("manual: only the id comes back", Object.keys(isRow(manual.body) ? manual.body : {}), ["_id"]),
    same("manual: name is trimmed and keeps accents, symbols and CJK", m.name, "Crème brûlée ☕ 日本"),
    same("manual: description kept as typed", m.description, "Dessert 🍮 line one\nline two"),
    same("manual: disabled draft", [m.enabled, m.version, m.revision], [false, 1, 1]),
    same("manual: one trigger node, no edges", [list(m.graph, "nodes").length, list(m.graph, "triggerEdges").length, list(m.graph, "dataEdges").length], [1, 0, 0]),
    same("manual: the trigger", [node(m).kind, node(m).typeId, node(m).config, node(m).position], ["trigger", "manual", {}, { x: 80, y: 160 }]),
    matches("manual: node id is node_ plus 8 hex digits", node(m).id, NODE_ID),
    same("webhook: the trigger has POST and a path from the name", [node(h).typeId, node(h).config], ["webhook", { path: "/webhooks/sync-paid-invoices", method: "POST" }]),
    same("webhook: description defaults to empty", h.description, ""),
    same("schedule: default expression is Mondays at 09:00", [node(c).typeId, node(c).config], ["schedule.cron", { cron: "0 9 * * 1" }]),
    same("schedule: a null description is stored empty", c.description, ""),
    same("schedule: unicode name kept", c.name, "日本語"),
  ]);
  const rows = [await summaryOf(ctx, ids[0]), await summaryOf(ctx, ids[1]), await summaryOf(ctx, ids[2])];
  const exported = await auto(ctx, "export the manual draft", "GET", `/procedures/${ids[0]}/export`);
  await ctx.verify("a second view", [
    same("the three are drafts in the summary", rows.map((r) => r.status), ["draft", "draft", "draft"]),
    same("the summary names their triggers", rows.map((r) => r.trigger), ["manual", "webhook", "schedule.cron"]),
    same("the webhook row reads POST and the path", rows[1].triggerText, "POST /webhooks/sync-paid-invoices"),
    same("export of the draft", [pick(exported.body, "name"), pick(exported.body, "description")], ["Crème brûlée ☕ 日本", "Dessert 🍮 line one\nline two"]),
  ]);
}

/** @param {Ctx} ctx */
export async function webhookPathComesFromTheName(ctx) {
  /** @type {[string, string][]} */
  const cases = [
    ["Crème Brûlée ☕ 日本", "/webhooks/creme-brulee"],
    ["日本語", "/webhooks/procedure"],
    ["--Hello__World--", "/webhooks/hello-world"],
    ["a".repeat(50), `/webhooks/${"a".repeat(40)}`],
    ["Sync paid invoices", "/webhooks/sync-paid-invoices"],
    ["Sync paid invoices", "/webhooks/sync-paid-invoices-2"],
    ["sync PAID invoices", "/webhooks/sync-paid-invoices-3"],
  ];
  const paths = [];
  for (const [name] of cases) {
    const made = await newProcedure(ctx, { name, trigger: "webhook" });
    const saved = await procedureOf(ctx, text(made.body, "_id"));
    paths.push(pick(list(saved.graph, "nodes")[0], "config", "path"));
  }
  await ctx.verify("webhook paths", cases.map(([name, expected], index) => same(`"${name.slice(0, 20)}" gets ${expected}`, paths[index], expected)));
}

/** @param {Ctx} ctx */
export async function validatesLimits(ctx) {
  const before = await procedureCount(ctx);
  const padded = await newProcedure(ctx, { name: `   ${"é".repeat(200)}   `, trigger: "manual" });
  const longest = await newProcedure(ctx, { name: "x".repeat(200), trigger: "manual", description: "😀".repeat(1000) });
  const tooLong = await newProcedure(ctx, { name: "x".repeat(201), trigger: "manual" });
  const descTooLong = await newProcedure(ctx, { name: "ok", trigger: "manual", description: "😀".repeat(1001) });
  const desc2001 = await newProcedure(ctx, { name: "ok", trigger: "manual", description: "a".repeat(2001) });
  const blank = await newProcedure(ctx, { name: " \t ", trigger: "manual" });
  const noName = await newProcedure(ctx, { trigger: "manual" });
  const badTrigger = await newProcedure(ctx, { name: "ok", trigger: "nope" });
  const noTrigger = await newProcedure(ctx, { name: "ok" });
  const notText = await newProcedure(ctx, { name: 5, trigger: "manual" });
  const empty = await auto(ctx, "no body", "POST", "/procedures/new", {});
  const array = await newProcedure(ctx, [], "array body");
  const after = await procedureCount(ctx);
  const saved = await procedureOf(ctx, text(padded.body, "_id"));
  const savedLongest = await procedureOf(ctx, text(longest.body, "_id"));
  const tooBig = (/** @type {import("../../auto.mjs").Answer} */ a) => list(a.body, "issues")[0];
  await ctx.verify("limits", [
    same("200 characters between spaces is accepted trimmed", [padded.status, saved.name], [200, "é".repeat(200)]),
    same("200 characters name with a 2000-unit description is accepted", [longest.status, savedLongest.description === "😀".repeat(1000), String(savedLongest.name).length], [200, true, 200]),
    ...refusedBody(tooLong, "name of 201", ["name"]),
    same("the 201 issue says too_big, maximum 200", [tooBig(tooLong)?.code, tooBig(tooLong)?.maximum], ["too_big", 200]),
    ...refusedBody(descTooLong, "description of 2002 UTF-16 units", ["description"]),
    ...refusedBody(desc2001, "description of 2001", ["description"]),
    same("the 2001 issue says maximum 2000", [tooBig(desc2001)?.code, tooBig(desc2001)?.maximum], ["too_big", 2000]),
    ...refusedBody(blank, "blank name", ["name"]),
    same("the blank issue says too_small, minimum 1", [tooBig(blank)?.code, tooBig(blank)?.minimum], ["too_small", 1]),
    ...refusedBody(noName, "missing name", ["name"]),
    ...refusedBody(badTrigger, "unknown trigger", ["trigger"]),
    same("the unknown trigger issue lists the three starters", tooBig(badTrigger)?.options, ["webhook", "schedule.cron", "manual"]),
    ...refusedBody(noTrigger, "missing trigger", ["trigger"]),
    ...refusedBody(notText, "name that is a number", ["name"]),
    same("no body: 400 and an issue on the body itself", [empty.status, list(empty.body, "issues")[0]?.path], [400, []]),
    same("an array body is refused", array.status, 400),
    same("only the two accepted bodies created a procedure", after - before, 2),
  ]);
}

/** @param {Ctx} ctx */
export async function nameWarning(ctx) {
  const first = await newProcedure(ctx, { name: "Same Name", trigger: "manual" });
  const second = await newProcedure(ctx, { name: "  same name ", trigger: "manual" });
  const third = await newProcedure(ctx, { name: "SAME NAME é", trigger: "manual" });
  const imported = await auto(ctx, "import with the taken name", "POST", "/procedures/import", { body: { json: JSON.stringify({ name: "same NAME", graph: EMPTY_GRAPH }) } });
  const check1 = await auto(ctx, "validate a unique one under its own name", "POST", "/procedures/validate", { body: { graph: EMPTY_GRAPH, procedureId: text(third.body, "_id"), name: "SAME NAME é" } });
  const check2 = await auto(ctx, "validate a fresh draft under the name", "POST", "/procedures/validate", { body: { graph: EMPTY_GRAPH, name: "same name" } });
  const warning = "$dms_automation.api.nameTaken";
  const total = await procedureCount(ctx);
  const nameIssue = list(check2.body, "issues").find((i) => i.code === "nameTaken");
  await ctx.verify("name collisions", [
    same("the first has no warning", Object.keys(isRow(first.body) ? first.body : {}), ["_id"]),
    same("the second answers the warning key", pick(second.body, "warning"), warning),
    same("a different name has no warning", pick(third.body, "warning"), undefined),
    same("import warns too and still creates", [pick(imported.body, "warning"), imported.status, text(imported.body, "_id").length > 0], [warning, 200, true]),
    same("all four exist", total, 4),
    same("validate does not warn about the procedure's own name", list(check1.body, "issues").filter((i) => i.code === "nameTaken"), []),
    same("validate warns for another procedure's name", [nameIssue?.severity, nameIssue?.params, nameIssue?.message], ["warning", { name: "same name" }, 'another procedure is already named "same name"']),
  ]);
}

/** @param {Ctx} ctx */
export async function importRoundTrip(ctx) {
  const source = graph(
    [
      trigger("t", "webhook", { path: "/hooks/round-trip", method: "PUT" }),
      action("e", "verify.echo", { value: "é 日本 😀" }),
      data("u", "verify.upper", { text: "fallback ü" }),
    ],
    [tedge("t", "e")],
    [dedge("u", "text", "e", "value")],
  );
  const name = "Round trip é 日本 😀";
  const imported = await auto(ctx, "import", "POST", "/procedures/import", { body: { json: JSON.stringify({ name, description: "desc ü", graph: source }) } });
  const id = text(imported.body, "_id");
  const saved = await procedureOf(ctx, id);
  const exported = await auto(ctx, "export", "GET", `/procedures/${id}/export`);
  const again = await auto(ctx, "import the export", "POST", "/procedures/import", { body: { json: JSON.stringify(exported.body) } });
  const copy = await procedureOf(ctx, text(again.body, "_id"));
  const copyNode = list(copy.graph, "nodes")[0];
  const noDescription = await auto(ctx, "import without a description", "POST", "/procedures/import", { body: { json: JSON.stringify({ name: "No description", graph: EMPTY_GRAPH }) } });
  const untriggered = await auto(ctx, "import a graph with a step nothing triggers", "POST", "/procedures/import", { body: { json: JSON.stringify({ name: "Loose step", graph: graph([trigger("t"), action("log", "log.message", { message: "x" })]) }) } });
  await ctx.verify("import and export", [
    same("import answers 200 with an id and no issue for a clean graph", [imported.status, id.length > 0, pick(imported.body, "issues")], [200, true, []]),
    same("the import is a disabled draft at version 1 revision 1", [saved.enabled, saved.version, saved.revision], [false, 1, 1]),
    same("name and description are kept", [saved.name, saved.description], [name, "desc ü"]),
    same("the graph is stored as exported", saved.graph, source),
    same("export has exactly name, description and graph", Object.keys(isRow(exported.body) ? exported.body : {}).sort(), ["description", "graph", "name"]),
    same("export graph equals the import", pick(exported.body, "graph"), source),
    same("importing the export warns the name is taken", pick(again.body, "warning"), "$dms_automation.api.nameTaken"),
    same("the copy's webhook moved to a free path, the method kept", copyNode?.config, { path: "/hooks/round-trip-2", method: "PUT" }),
    same("the rest of the copy's graph is the same", [copy.graph && list(copy.graph, "nodes").slice(1), list(copy.graph, "triggerEdges"), list(copy.graph, "dataEdges")], [source.nodes.slice(1), source.triggerEdges, source.dataEdges]),
    same("a missing description imports as empty", (await procedureOf(ctx, text(noDescription.body, "_id"))).description, ""),
    same("problems of the graph come back as issues, the draft still exists", [untriggered.status, pick(list(untriggered.body, "issues")[0], "severity"), pick(list(untriggered.body, "issues")[0], "code"), pick(list(untriggered.body, "issues")[0], "nodeId")], [200, "warning", "untriggered", "log"]),
  ]);
}

/** @param {Ctx} ctx */
export async function importRefusals(ctx) {
  const before = await procedureCount(ctx);
  const send = (/** @type {string} */ label, /** @type {unknown} */ body) => auto(ctx, label, "POST", "/procedures/import", { body });
  const raw = (/** @type {unknown} */ value) => ({ json: isText(value) ? value : JSON.stringify(value) });
  const node = { id: "a", kind: "wat", config: {}, position: { x: 0, y: 0 } };
  const cases = {
    notJson: await send("not JSON", raw("{nope")),
    truncated: await send("truncated JSON", raw('{"name":"x","graph":')),
    noName: await send("no name", raw({ graph: EMPTY_GRAPH })),
    noGraph: await send("no graph", raw({ name: "x" })),
    unknownKind: await send("unknown kind", raw({ name: "x", graph: graph([node]) })),
    badGraph: await send("graph that is not a graph", raw({ name: "x", graph: { nodes: 3 } })),
    badPosition: await send("position that is not a position", raw({ name: "x", graph: graph([{ id: "t", kind: "trigger", typeId: "manual", config: {}, position: "z" }]) })),
    nameTooLong: await send("name of 201", raw({ name: "x".repeat(201), graph: EMPTY_GRAPH })),
    blankName: await send("blank name", raw({ name: "  ", graph: EMPTY_GRAPH })),
    descTooLong: await send("description of 2001", raw({ name: "x", description: "a".repeat(2001), graph: EMPTY_GRAPH })),
    array: await send("an array", raw("[]")),
    emptyJson: await send("empty json field", { json: "" }),
    noJsonField: await send("no json field", {}),
    jsonNotText: await send("json that is an object", { json: { name: "x" } }),
  };
  const field = (/** @type {import("../../auto.mjs").Answer} */ a) => [a.status, pick(a.body, "field")];
  const msg = (/** @type {import("../../auto.mjs").Answer} */ a) => pick(a.body, "message");
  await ctx.verify("refusals", [
    same("not JSON: 400 on the json field, with the notJson text", [...field(cases.notJson), msg(cases.notJson)], [400, "json", "$dms_automation.importProcedure.notJson"]),
    same("truncated JSON is not JSON", [...field(cases.truncated), msg(cases.truncated)], [400, "json", "$dms_automation.importProcedure.notJson"]),
    same("no name is not an exported procedure", [...field(cases.noName), msg(cases.noName)], [400, "json", "$dms_automation.importProcedure.notProcedure"]),
    same("no graph is not an exported procedure", [...field(cases.noGraph), msg(cases.noGraph)], [400, "json", "$dms_automation.importProcedure.notProcedure"]),
    same("a kind of step this installation does not have", [...field(cases.unknownKind), msg(cases.unknownKind)], [400, "json", "$dms_automation.importProcedure.unknownKind"]),
    same("a graph of another shape", [...field(cases.badGraph), msg(cases.badGraph)], [400, "json", "$dms_automation.importProcedure.invalidGraph"]),
    same("a node with a bad position", [...field(cases.badPosition), msg(cases.badPosition)], [400, "json", "$dms_automation.importProcedure.invalidGraph"]),
    same("a name of 201 is refused on the json field", field(cases.nameTooLong), [400, "json"]),
    same("a blank name is refused on the json field", field(cases.blankName), [400, "json"]),
    same("a description of 2001 is refused on the json field", field(cases.descTooLong), [400, "json"]),
    same("an array is refused on the json field", field(cases.array), [400, "json"]),
    ...[cases.emptyJson, cases.noJsonField, cases.jsonNotText].map((a, index) => same(`body problem ${index + 1}: 400 invalid body on json`, [a.status, pick(a.body, "error"), list(a.body, "issues")[0]?.path], [400, "invalid body", ["json"]])),
    same("nothing was created", (await procedureCount(ctx)) - before, 0),
  ]);
}

/** @param {Ctx} ctx */
export async function duplicate(ctx) {
  const graphOf = graph([trigger("t", "webhook", { path: "/hooks/dup", method: "POST" }), action("l", "log.message", { message: "x ü" })], [tedge("t", "l")]);
  const id = await createProcedure(ctx, { name: "Original é", description: "Original description 日本", graph: graphOf });
  await auto(ctx, "enable the original", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
  const dup = await auto(ctx, "duplicate", "POST", `/procedures/${id}/duplicate`);
  const dupId = text(dup.body, "_id");
  const copy = await procedureOf(ctx, dupId);
  const original = await procedureOf(ctx, id);
  const twice = await auto(ctx, "duplicate the copy", "POST", `/procedures/${dupId}/duplicate`);
  const long = await createProcedure(ctx, { name: "L".repeat(200), graph: EMPTY_GRAPH });
  const longCopy = await procedureOf(ctx, text(await auto(ctx, "duplicate the 200 character name", "POST", `/procedures/${long}/duplicate`).then((a) => a.body), "_id"));
  const missing = await auto(ctx, "duplicate nothing", "POST", "/procedures/nope/duplicate");
  const copyNodes = list(copy.graph, "nodes");
  await ctx.verify("the copy", [
    same("duplicate answers only the new id", [dup.status, Object.keys(isRow(dup.body) ? dup.body : {}), dupId !== id], [200, ["_id"], true]),
    same("the copy is named <name> (copy)", copy.name, "Original é (copy)"),
    same("the description is kept", copy.description, "Original description 日本"),
    same("the copy is disabled although the original is enabled", [copy.enabled, original.enabled], [false, true]),
    same("version and revision restart at 1", [copy.version, copy.revision], [1, 1]),
    same("its webhook moved to a free path", copyNodes[0]?.config, { path: "/hooks/dup-2", method: "POST" }),
    same("the other nodes and edges are the same", [copyNodes.slice(1), copy.graph && list(copy.graph, "triggerEdges")], [graphOf.nodes.slice(1), graphOf.triggerEdges]),
    same("the original is untouched", [original.graph, original.name], [graphOf, "Original é"]),
    same("a copy of a copy", (await procedureOf(ctx, text(twice.body, "_id"))).name, "Original é (copy) (copy)"),
    same("the copy of the copy moves its own path on", list((await procedureOf(ctx, text(twice.body, "_id"))).graph, "nodes")[0]?.config, { path: "/hooks/dup-2-2", method: "POST" }),
    same("a name of 200 characters is cut so the copy fits 200", [String(longCopy.name).length, longCopy.name === `${"L".repeat(193)} (copy)`], [200, true]),
    ...notFound(missing, "duplicate of an unknown id", "nope"),
  ]);
  const copyRow = await summaryOf(ctx, dupId);
  await ctx.verify("the copy in the list", [same("it is a draft with no runs", [copyRow.status, copyRow.runs, copyRow.lastRunAt], ["draft", 0, null])]);
}
