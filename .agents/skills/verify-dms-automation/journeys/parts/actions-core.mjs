import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auto, check, fixture, list, same, text } from "../../auto.mjs";
import { action, chain, createProcedure, dedge, graph, runNow, tedge, trigger } from "../../procs.mjs";
import { endedAs, inputValue, outputValue, runGraph, stepsOfNode, userLogs } from "./runtime-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

export const LOG_VALUES = [
  { label: "an object with accents and CJK", value: { "café": ["日本", { deep: null }], n: 1.5 } },
  { label: "a list", value: [1, "two", false, null] },
  { label: "a text", value: "line one\nline é🚀" },
  { label: "zero", value: 0 },
  { label: "false", value: false },
  { label: "null", value: null },
];

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function logChecks(ctx) {
  const levels = ["info", "warn", "error"];
  const nodes = [trigger("t")];
  levels.forEach((level) => nodes.push(action(level, "log.message", { message: `a ${level} message é日🚀`, level })));
  nodes.push(action("default", "log.message", { message: "no level given" }));
  nodes.push(action("bare", "log.message", {}));
  LOG_VALUES.forEach((one, index) => nodes.push(action(`v${index}`, "log.message", { message: one.label, value: one.value, level: "warn" })));
  nodes.push(action("echo", "log.message", {}));
  const edges = [dedge("v0", "message", "echo", "message"), dedge("v0", "value", "echo", "value")];
  const ran = await runGraph(ctx, chain(nodes, edges));
  const logs = userLogs(ran);
  const entryOf = (/** @type {string} */ id) => ran.entries.find((entry) => entry.source === "log" && entry.nodeId === id);
  const checks = [endedAs("the run", ran, "ok")];
  for (const level of levels) {
    checks.push(same(`${level}: level and message in the run's logs`, [entryOf(level)?.level, entryOf(level)?.message], [level, `a ${level} message é日🚀`]));
  }
  checks.push(same("the level defaults to info", [entryOf("default")?.level, entryOf("default")?.message], ["info", "no level given"]));
  checks.push(same("no message is an empty message, at info", [entryOf("bare")?.level, entryOf("bare")?.message], ["info", ""]));
  checks.push(check("a log without a value has no value", entryOf("default") !== undefined && !("value" in (entryOf("default") ?? {})), JSON.stringify(entryOf("default"))));
  LOG_VALUES.forEach((one, index) => {
    checks.push(same(`structured value, ${one.label}`, [entryOf(`v${index}`)?.level, entryOf(`v${index}`)?.value], ["warn", one.value]));
  });
  checks.push(same("the entries come in the order of the steps", logs.filter((entry) => entry.nodeId !== "echo").map((entry) => entry.nodeId), ["info", "warn", "error", "default", "bare", "v0", "v1", "v2", "v3", "v4", "v5"]));
  checks.push(same("the action's output is its message and value", outputValue(stepsOfNode(ran, "v0")[0]), { message: LOG_VALUES[0].label, value: LOG_VALUES[0].value }));
  checks.push(same("a later step logs the wired message and value", [entryOf("echo")?.message, entryOf("echo")?.value], [LOG_VALUES[0].label, LOG_VALUES[0].value]));
  const fireId = text(stepsOfNode(ran, "info")[0], "fireId");
  const engineRun = fireId.slice(0, fireId.lastIndexOf("-f"));
  const backend = readFileSync(join(text(ctx.state, "logs"), "backend.log"), "utf8");
  checks.push(check("the backend log has the message of a warn, tagged with the run and the node", backend.split("\n").some((line) => line.includes("[WARN]") && line.includes(`[run=${engineRun} node=v1]`) && line.includes("a list")), engineRun));
  checks.push(check("the backend log has the message of an error", backend.split("\n").some((line) => line.includes("[ERROR]") && line.includes(`[run=${engineRun} node=error] a error message`)), engineRun));
  checks.push(check("the backend log has the message of an info", backend.split("\n").some((line) => line.includes("[INFO]") && line.includes(`[run=${engineRun} node=info] a info message é日🚀`)), engineRun));
  const bad = await createProcedure(ctx, { graph: graph([trigger("t"), action("l", "log.message", { message: "x", level: "fatal" })], [tedge("t", "l")]) });
  const refused = await runNow(ctx, bad, {});
  checks.push(same("a level outside info, warn and error is refused", refused.answer.status, 400));
  checks.push(same("a level outside the choices: the problem", list(refused.answer.body, "issues").filter((issue) => issue.severity === "error").map((issue) => issue.code), ["notInEnum"]));
  return checks;
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function contextChecks(ctx) {
  const ran = await runGraph(ctx, chain([trigger("t"), action("who", "verify.context", {}), action("levels", "verify.log-levels", { message: "X" })]));
  const step = stepsOfNode(ran, "who")[0];
  const fireId = text(step, "fireId");
  const logs = userLogs(ran).filter((entry) => entry.nodeId === "levels");
  const testGraph = chain([trigger("t"), action("who", "verify.context", {})]);
  const tested = await auto(ctx, "test run the draft", "POST", `/procedures/${ran.id}/test`, { body: { graph: testGraph, payload: {} } });
  const testRun = (await auto(ctx, "read the test run", "GET", `/runs/${text(tested.body, "runId")}`)).body;
  const testStep = stepsOfNode({ steps: list(testRun, "trace", "steps") }, "who")[0];
  return [
    same("ctx.dryRun is true throughout a test run", [text(testRun, "kind"), outputValue(testStep)?.dryRun], ["test", true]),
    endedAs("the run", ran, "ok"),
    same("ctx carries the procedure id, the node id and dryRun false", [outputValue(step)?.procedureId, outputValue(step)?.nodeId, outputValue(step)?.dryRun], [ran.id, "who", false]),
    same("ctx.runId is the run the trace belongs to", outputValue(step)?.runId, fireId.slice(0, fireId.lastIndexOf("-f"))),
    same("ctx.log writes the level, the message and the structured value", logs.map((entry) => [entry.level, entry.message, entry.value]), [["info", "info X", { level: "info", list: [1, 2, 3] }], ["warn", "warn X", "text value"], ["error", "error X", undefined]]),
    same("the logs of ctx.log belong to the node that called it", [...new Set(logs.map((entry) => entry.nodeId))], ["levels"]),
  ];
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function outputChecks(ctx) {
  const checks = [];
  const echo = await runGraph(
    ctx,
    chain([trigger("t"), action("e", "verify.echo", { value: { k: ["é"] }, n: 7 }), action("l", "log.message", {})], [dedge("e", "value", "l", "value"), dedge("e", "n", "l", "message")]),
  );
  checks.push(endedAs("an action that returns an object", echo, "ok"));
  checks.push(same("its fields feed the next step", [inputValue(stepsOfNode(echo, "l")[0], "value"), inputValue(stepsOfNode(echo, "l")[0], "message")], [{ k: ["é"] }, 7]));
  checks.push(same("its output is in the trace", outputValue(stepsOfNode(echo, "e")[0]), { value: { k: ["é"] }, n: 7 }));
  const nothing = await runGraph(ctx, chain([trigger("t"), action("n", "verify.nothing", {}), action("l", "log.message", { message: "after nothing" })], [dedge("n", "anything", "l", "value")]));
  checks.push(endedAs("an action that returns nothing", nothing, "ok"));
  checks.push(same("it leaves the step without output", outputValue(stepsOfNode(nothing, "n")[0]), {}));
  checks.push(same("the next step runs and gets nothing from it", [stepsOfNode(nothing, "l").length, inputValue(stepsOfNode(nothing, "l")[0], "value")], [1, undefined]));
  for (const [id, label] of [["verify.array-output", "an array"], ["verify.string-output", "a text"]]) {
    const bad = await runGraph(ctx, chain([trigger("t"), action("x", id, {}), action("l", "log.message", { message: "never" })]));
    checks.push(endedAs(`an action that returns ${label}`, bad, "failed"));
    checks.push(same(`${label}: the error`, bad.error, `action type "${id}" must resolve with an object or nothing`));
    checks.push(same(`${label}: the failed step`, bad.failedNodeId, "x"));
    checks.push(same(`${label}: nothing runs after`, stepsOfNode(bad, "l").length, 0));
  }
  return checks;
}

export const THROWN_TEXT = [
  { kind: "string", message: "plain string failure" },
  { kind: "number", message: "42" },
  { kind: "object", message: "[object Object]" },
  { kind: "null", message: "null" },
  { kind: "undefined", message: "undefined" },
  { kind: "empty-string", message: "" },
  { kind: "array", message: "a,b" },
];

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function throwChecks(ctx) {
  const checks = [];
  const error = await runGraph(ctx, chain([trigger("t"), action("x", "verify.fail", { message: "unicode é日🚀 failure" })]));
  checks.push(same("an Error: the run's error", error.error, "unicode é日🚀 failure"));
  checks.push(same("an Error: the step failed with the message", [stepsOfNode(error, "x")[0]?.status, stepsOfNode(error, "x")[0]?.error], ["failed", "unicode é日🚀 failure"]));
  checks.push(same("an Error: an error entry in the logs", error.entries.filter((entry) => entry.level === "error" && entry.nodeId === "x").map((entry) => entry.message), ["unicode é日🚀 failure"]));
  for (const one of THROWN_TEXT) {
    const ran = await runGraph(ctx, chain([trigger("t"), action("x", "verify.throw", { kind: one.kind }), action("l", "log.message", { message: "never" })]));
    const step = stepsOfNode(ran, "x")[0];
    checks.push(same(`thrown ${one.kind}: status, run error and failed node`, [ran.status, ran.error ?? "", ran.failedNodeId], ["failed", one.message, "x"]));
    checks.push(same(`thrown ${one.kind}: the step carries the text`, [step?.status, step?.error ?? ""], ["failed", one.message]));
    checks.push(same(`thrown ${one.kind}: an error entry`, ran.entries.filter((entry) => entry.level === "error" && entry.nodeId === "x").map((entry) => entry.message), [one.message]));
    checks.push(same(`thrown ${one.kind}: nothing runs after`, stepsOfNode(ran, "l").length, 0));
  }
  return checks;
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function typeStateChecks(ctx) {
  const checks = [];
  const g = chain([trigger("t"), action("x", "verify.echo", { value: 1 }), action("l", "log.message", { message: "after" })]);
  const id = await createProcedure(ctx, { graph: g });
  const off = await auto(ctx, "switch the action type off", "PUT", "/action-types/verify.echo/config", { body: { enabled: false } });
  checks.push(same("switching the type off answers its id", off.body, { id: "verify.echo" }));
  const failed = await runNow(ctx, id, {});
  const run = failed.runId ? (await auto(ctx, "read the run", "GET", `/runs/${failed.runId}`)).body : {};
  checks.push(same("a step of a disabled type fails", failed.status, "failed"));
  checks.push(same("a step of a disabled type: the error", text(run, "errorMessage"), 'action type "verify.echo" is disabled in the library'));
  checks.push(same("a step of a disabled type: the failed node", text(run, "failedNodeId"), "x"));
  const listing = await auto(ctx, "list the action types", "GET", "/action-types");
  checks.push(same("the library lists the type as off", list(listing.body).find((row) => row.id === "verify.echo")?.enabled, false));
  const warned = await auto(ctx, "validate the graph", "POST", "/procedures/validate", { body: { graph: g } });
  checks.push(same("the graph's problems warn that the type is disabled", list(warned.body, "issues").filter((issue) => issue.code === "typeDisabled").map((issue) => [issue.severity, issue.message, issue.nodeId]), [["warning", 'type "verify.echo" is disabled in the library', "x"]]));
  await auto(ctx, "switch the action type on", "PUT", "/action-types/verify.echo/config", { body: { enabled: true } });
  const back = await runNow(ctx, id, {});
  checks.push(same("the same procedure runs again once the type is on", back.status, "ok"));
  await fixture(ctx, "unregister the action type", "POST", "/types/unregister", { kind: "action", id: "verify.echo" });
  const gone = await runNow(ctx, id, {});
  checks.push(same("a step of an unregistered type: Run now is refused", gone.answer.status, 400));
  checks.push(same("a step of an unregistered type: the problem", list(gone.answer.body, "issues").filter((issue) => issue.severity === "error").map((issue) => [issue.code, issue.message, issue.nodeId]), [["unknownType", 'action node "x" references unknown type "verify.echo"', "x"]]));
  await fixture(ctx, "register the action type again", "POST", "/types/register", { kind: "action", id: "verify.echo" });
  const again = await runNow(ctx, id, {});
  checks.push(same("the procedure runs once the type registers again", again.status, "ok"));
  return checks;
}
