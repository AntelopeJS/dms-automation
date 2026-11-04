import { auto, fixture, list, pick, same, text } from "../../auto.mjs";
import { action, chain, createProcedure, data, dedge, runNow, trigger } from "../../procs.mjs";
import { endedAs, inputValue, rowOf, runGraph, stepsOfNode } from "./runtime-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * @param {import("../../auto.mjs").Answer} answer A refused Run now
 * @returns {unknown[][]} The code, message and node of each error among its issues
 */
function errorsOf(answer) {
  return list(answer.body, "issues").filter((issue) => issue.severity === "error").map((issue) => [issue.code, issue.message, issue.nodeId]);
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function wiringChecks(ctx) {
  const nodes = [
    trigger("t"),
    action("echo", "verify.echo", { value: "ping" }),
    action("l1", "log.message", { message: "a chain of data nodes" }),
    action("l2", "log.message", { message: "a wired field wins over its setting" }),
    action("l3", "log.message", { message: "a port the source lacks keeps the setting" }),
    action("l4", "log.message", { message: "a field left unwired takes the default" }),
    action("l5", "log.message", { message: "the trigger payload feeds a field" }),
    action("l6", "log.message", { message: "an action output feeds a field" }),
    action("l7", "log.message", { message: "one data node, read twice (first)" }),
    action("l8", "log.message", { message: "one data node, read twice (second)" }),
    data("c1", "const.string", { value: "  Hello " }),
    data("trim", "string.trim"),
    data("up", "string.toUpperCase"),
    data("bang", "const.string", { value: "!" }),
    data("join", "string.concat"),
    data("wired", "const.string", { value: "wired" }),
    data("w2", "string.concat", { a: "setting", b: "B" }),
    data("w3", "string.concat", { a: "setting", b: "B" }),
    data("w4", "string.concat", { a: "ignored by default" }),
    data("get", "object.get", { path: "user.name" }),
    data("echoUp", "string.toUpperCase"),
    data("shared", "math.add", { a: 20, b: 22 }),
  ];
  nodes[nodes.findIndex((node) => node.id === "w4")].config = {};
  const edges = [
    dedge("c1", "value", "trim", "s"),
    dedge("trim", "result", "up", "s"),
    dedge("up", "result", "join", "a"),
    dedge("bang", "value", "join", "b"),
    dedge("join", "result", "l1", "value"),
    dedge("wired", "value", "w2", "a"),
    dedge("w2", "result", "l2", "value"),
    dedge("wired", "nope", "w3", "a"),
    dedge("w3", "result", "l3", "value"),
    dedge("wired", "value", "w4", "b"),
    dedge("w4", "result", "l4", "value"),
    dedge("t", "payload", "get", "obj"),
    dedge("get", "result", "l5", "value"),
    dedge("echo", "value", "echoUp", "s"),
    dedge("echoUp", "result", "l6", "value"),
    dedge("shared", "result", "l7", "value"),
    dedge("shared", "result", "l8", "value"),
  ];
  const wiring = chain([nodes[0], nodes[1], ...nodes.slice(2, 10)], edges);
  wiring.nodes.push(...nodes.slice(10));
  const ran = await runGraph(ctx, wiring, { payload: { payload: { user: { name: "Zoë 李" } } } });
  const received = (/** @type {string} */ id) => inputValue(stepsOfNode(ran, id)[0], "value");
  return [
    endedAs("the run", ran, "ok"),
    same("Trim, Uppercase and Join text chained from a constant", received("l1"), "HELLO!"),
    same("a wired field wins over the node's setting", received("l2"), "wiredB"),
    same("an edge from a port the source does not have changes nothing", received("l3"), "settingB"),
    same("an unwired field with a default takes it, the wired one is used", received("l4"), "wired"),
    same("a field wired from the trigger payload", received("l5"), "Zoë 李"),
    same("a field wired from an action's output", received("l6"), "PING"),
    same("a data node read by two steps gives both the same value", [received("l7"), received("l8")], [42, 42]),
    same("a data node read twice is evaluated once", ran.entries.filter((entry) => entry.message === "evaluated math.add").length, 1),
  ];
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function cycleChecks(ctx) {
  const cyc = chain([trigger("t"), action("l", "log.message", {})], [dedge("A", "result", "l", "value"), dedge("B", "result", "A", "a"), dedge("A", "result", "B", "a")]);
  cyc.nodes.push(data("A", "math.add", { b: 1 }), data("B", "math.add", { b: 1 }));
  const id = await createProcedure(ctx, { graph: cyc });
  const refused = await runNow(ctx, id, {});
  return [
    same("Run now refuses a cycle of data nodes", refused.answer.status, 400),
    same("the problem names the cycle", errorsOf(refused.answer), [["dataCycle", 'cycle detected in data edges: "B", "A"', "B"]]),
  ];
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function customDataChecks(ctx) {
  const probe = async (/** @type {string} */ type, /** @type {Record<string, unknown>} */ config, /** @type {Record<string, unknown>} */ extra = {}) => {
    const g = chain([trigger("t"), action("l", "log.message", {})], [dedge("d", "text", "l", "value")]);
    g.nodes.push(data("d", type, config));
    if (extra.source) {
      g.nodes.push(data("s", "const.string", { value: extra.source }));
      g.dataEdges.push(dedge("s", "value", "d", "text"));
    }
    return runGraph(ctx, g);
  };
  const defaulted = await probe("verify.upper", {});
  const configured = await probe("verify.upper", { text: "café" });
  const wired = await probe("verify.upper", { text: "ignored" }, { source: "wired 日本" });
  const suffixed = await probe("verify.suffix", { suffix: "!?" }, { source: "hi" });
  const listing = await auto(ctx, "list the data node types", "GET", "/data-node-types");
  const suffixType = list(listing.body).find((row) => row.id === "verify.suffix");
  const bad = await probe("verify.bad-data", {});
  const throwing = await probe("verify.throwing-data", {});
  await fixture(ctx, "unregister the type", "POST", "/types/unregister", { kind: "data", id: "verify.upper" });
  const goneGraph = chain([trigger("t"), action("l", "log.message", {})], [dedge("d", "text", "l", "value")]);
  goneGraph.nodes.push(data("d", "verify.upper", {}));
  const goneAnswer = (await runNow(ctx, await createProcedure(ctx, { graph: goneGraph }), {})).answer;
  await fixture(ctx, "register the type again", "POST", "/types/register", { kind: "data", id: "verify.upper" });
  const back = await probe("verify.upper", { text: "back" });
  const received = (/** @type {import("./runtime-kit.mjs").Ran} */ ran) => inputValue(stepsOfNode(ran, "l")[0], "value");
  return [
    same("the schema default applies when nothing is given", received(defaulted), "FALLBACK"),
    same("a configured value replaces the default", received(configured), "CAFÉ"),
    same("a wired value replaces the configured one", received(wired), "WIRED 日本"),
    same("a config field is merged into the evaluation input", received(suffixed), "hi!?"),
    same("the suffix is a setting, not a port", [pick(suffixType, "inputSchema", "properties") && Object.keys(rowOf(pick(suffixType, "inputSchema", "properties"))), pick(suffixType, "configSchema", "properties") && Object.keys(rowOf(pick(suffixType, "configSchema", "properties")))], [["text"], ["suffix"]]),
    endedAs("a data node that returns an array", bad, "failed"),
    same("a data node that returns an array: the error", bad.error, 'data node type "verify.bad-data" must evaluate to an object'),
    same("a data node that returns an array: the step that read it failed", bad.failedNodeId, "l"),
    endedAs("a data node that throws", throwing, "failed"),
    same("a data node that throws: its message", throwing.error, "data node exploded"),
    same("an unregistered data node type: Run now is refused", goneAnswer.status, 400),
    same("an unregistered data node type: the problem names the node and the type", errorsOf(goneAnswer), [["unknownType", 'data node "d" references unknown type "verify.upper"', "d"]]),
    same("the type works again once registered", received(back), "BACK"),
  ];
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function typeListChecks(ctx) {
  const listing = await auto(ctx, "list the data node types", "GET", "/data-node-types");
  const builtin = list(listing.body).filter((row) => row.module === undefined);
  const byCategory = {};
  for (const row of builtin) (byCategory[text(row, "category")] ??= []).push(text(row, "id"));
  const portsOf = (/** @type {string} */ id) => {
    const row = builtin.find((candidate) => candidate.id === id);
    const keys = (/** @type {string} */ side) => Object.keys(rowOf(pick(row, side, "properties")));
    return { in: keys("inputSchema"), config: keys("configSchema"), out: keys("outputSchema") };
  };
  return [
    same("the categories of the built-in data nodes", Object.keys(byCategory), ["constant", "math", "compare", "boolean", "string", "object", "json"]),
    same("Constants", byCategory.constant, ["const.string", "const.number", "const.boolean", "const.json"]),
    same("Math", byCategory.math, ["math.add", "math.subtract", "math.multiply", "math.divide", "math.modulo", "math.power", "math.min", "math.max", "math.negate", "math.abs", "math.round", "math.floor", "math.ceil", "math.sqrt"]),
    same("Comparison", byCategory.compare, ["compare.eq", "compare.neq", "compare.lt", "compare.gt", "compare.lte", "compare.gte"]),
    same("Logic", byCategory.boolean, ["bool.and", "bool.or", "bool.xor", "bool.not"]),
    same("Text", byCategory.string, ["string.concat", "string.length", "string.substring", "string.toLowerCase", "string.toUpperCase", "string.trim", "string.split", "string.replace", "string.includes"]),
    same("Objects", byCategory.object, ["object.get", "object.set", "object.keys", "object.values", "object.merge"]),
    same("JSON", byCategory.json, ["json.parse", "json.stringify"]),
    same("a constant has a value setting and a value output, no input", portsOf("const.number"), { in: [], config: ["value"], out: ["value"] }),
    same("Add has inputs a and b and the output result", portsOf("math.add"), { in: ["a", "b"], config: [], out: ["result"] }),
    same("Negate has input a only", portsOf("math.negate"), { in: ["a"], config: [], out: ["result"] }),
    same("Equals has inputs a and b and a mode setting", portsOf("compare.eq"), { in: ["a", "b"], config: ["mode"], out: ["result"] }),
    same("Extract has s, start and end", portsOf("string.substring"), { in: ["s", "start", "end"], config: [], out: ["result"] }),
    same("Set a field has obj, path and value", portsOf("object.set"), { in: ["obj", "path", "value"], config: [], out: ["result"] }),
    same("Write JSON has value and pretty", portsOf("json.stringify"), { in: ["value", "pretty"], config: [], out: ["result"] }),
    same("the compare mode offers auto, number and text and defaults to auto", (() => {
      const row = builtin.find((candidate) => candidate.id === "compare.eq");
      const mode = pick(row, "configSchema", "properties", "mode");
      return [pick(mode, "enum"), pick(mode, "default")];
    })(), [["auto", "number", "text"], "auto"]),
  ];
}
