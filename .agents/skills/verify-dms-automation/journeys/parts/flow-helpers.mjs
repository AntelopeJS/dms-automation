import { auto, check, list, pick, same, text } from "../../auto.mjs";
import { action, clearLedger, createProcedure, dedge, flow, graph, runNow, tedge, trigger } from "../../procs.mjs";
import { endedAs, inputValue, ledgerOf, outputValue, ranOrder, rowOf, runGraph, stepsOfNode } from "./runtime-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function delayChecks(ctx) {
  const checks = [];
  const cases = [
    { label: "700 ms", ms: 700, waits: 700 },
    { label: "400 ms written as text", ms: "400", waits: 400 },
    { label: "0 ms", ms: 0, waits: 0 },
  ];
  for (const one of cases) {
    await clearLedger(ctx);
    const ran = await runGraph(
      ctx,
      graph(
        [trigger("t"), action("before", "verify.tick", { key: "before" }), flow("d", "delay", { ms: one.ms }), action("after", "verify.tick", { key: "after" })],
        [tedge("t", "before"), tedge("before", "d"), tedge("d", "after")],
      ),
    );
    const at = Object.fromEntries((await ledgerOf(ctx, "tick")).map((entry) => [String(entry.key), Number(entry.at)]));
    const gap = at.after - at.before;
    checks.push(endedAs(one.label, ran, "ok"));
    checks.push(same(`${one.label}: the steps run in order`, ranOrder(ran), ["t", "before", "d", "after"]));
    checks.push(check(`${one.label}: the next step starts no sooner than the delay`, gap >= one.waits - 5, `gap ${gap} ms`));
    checks.push(check(`${one.label}: the Delay step lasts the delay (to 5 ms)`, Number(stepsOfNode(ran, "d")[0]?.durationMs) >= one.waits - 5, String(stepsOfNode(ran, "d")[0]?.durationMs)));
    if (one.waits === 0) checks.push(check(`${one.label}: no waiting`, gap < 500, `gap ${gap} ms`));
    else checks.push(check(`${one.label}: it waits the delay and not much more`, gap < one.waits + 1500, `gap ${gap} ms`));
  }
  const id = await createProcedure(ctx, { graph: graph([trigger("t"), flow("d", "delay", { ms: -500 }), action("after", "verify.tick", { key: "x" })], [tedge("t", "d"), tedge("d", "after")]) });
  const refused = await runNow(ctx, id, {});
  checks.push(same("a negative delay: Run now is refused", refused.answer.status, 400));
  checks.push(same("a negative delay: the problem", list(refused.answer.body, "issues").filter((issue) => issue.severity === "error").map((issue) => [issue.code, issue.message, issue.nodeId]), [["belowMinimum", "Delay (ms) must be at least 0", "d"]]));
  return checks;
}

export const VARIABLES = [
  { label: "text", value: "Hello" },
  { label: "accents, CJK and emoji", value: "café 日本語 🚀" },
  { label: "empty text", value: "" },
  { label: "number", value: 42.5 },
  { label: "zero", value: 0 },
  { label: "false", value: false },
  { label: "null", value: null },
  { label: "object", value: { a: { b: [1, "two", null] }, "ключ": "значение" } },
  { label: "list", value: [3, "x", { k: true }] },
];

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function variableChecks(ctx) {
  const nodes = [trigger("t")];
  const triggerEdges = [];
  const dataEdges = [];
  let previous = "t";
  VARIABLES.forEach((one, index) => {
    nodes.push(flow(`v${index}`, "setVariable", { name: `var${index}`, value: one.value }));
    nodes.push(action(`l${index}`, "log.message", { message: one.label }));
    triggerEdges.push(tedge(previous, `v${index}`), tedge(`v${index}`, `l${index}`));
    dataEdges.push(dedge(`v${index}`, "value", `l${index}`, "value"));
    previous = `l${index}`;
  });
  const ran = await runGraph(ctx, graph(nodes, triggerEdges, dataEdges));
  const checks = [endedAs("the run", ran, "ok")];
  VARIABLES.forEach((one, index) => {
    checks.push(same(`${one.label}: the variable's output is the value`, outputValue(stepsOfNode(ran, `v${index}`)[0]), { value: one.value }));
    checks.push(same(`${one.label}: the next step receives it`, inputValue(stepsOfNode(ran, `l${index}`)[0], "value"), one.value));
  });
  return checks;
}

/**
 * The palette categories and ports the node kinds publish.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function kindChecks(ctx) {
  const answer = await auto(ctx, "list the node kinds", "GET", "/node-kinds");
  const kinds = new Map(list(answer.body).map((row) => [text(row, "kind"), rowOf(row.meta)]));
  const ui = (/** @type {string} */ kind) => rowOf(kinds.get(kind)?.ui);
  const ports = (/** @type {string} */ kind) => ({
    triggerOuts: ui(kind).staticTriggerOuts,
    dataIns: list(ui(kind), "staticDataIns").map((port) => [port.name, port.type ?? null]),
    dataOuts: list(ui(kind), "staticDataOuts").map((port) => [port.name, port.type ?? null]),
    main: ui(kind).hasMainTriggerOut,
  });
  const inCategory = (/** @type {string} */ category) => [...kinds].filter(([, meta]) => rowOf(meta.ui).category === category).map(([kind]) => kind).sort();
  return [
    same("the Flow group", inCategory("flow"), ["forRange", "foreach", "if", "parallel", "retry", "switch", "tryCatch"]),
    same("the Helpers group", inCategory("helper"), ["delay", "setVariable"]),
    same("If", ports("if"), { triggerOuts: ["then", "else"], dataIns: [["cond", "boolean"]], dataOuts: [], main: false }),
    same("Switch", ports("switch"), { triggerOuts: ["default"], dataIns: [["value", null]], dataOuts: [], main: false }),
    same("Switch makes a branch of each case", ui("switch").dynamicTriggerOutsFromConfig, "cases"),
    same("For each", ports("foreach"), { triggerOuts: ["body"], dataIns: [["items", "array"]], dataOuts: [["value", null], ["index", "number"]], main: true }),
    same("For range", ports("forRange"), { triggerOuts: ["body"], dataIns: [["start", "number"], ["end", "number"], ["step", "number"]], dataOuts: [["value", "number"], ["index", "number"]], main: true }),
    same("Parallel makes a branch of each configured port", [ports("parallel").main, ui("parallel").dynamicTriggerOutsFromConfig, ui("parallel").defaultConfig], [true, "ports", { ports: ["a", "b"] }]),
    same("Try / Catch", ports("tryCatch"), { triggerOuts: ["try", "catch"], dataIns: [], dataOuts: [["error", "string"], ["name", "string"]], main: true }),
    same("Retry", ports("retry"), { triggerOuts: ["body", "exhausted"], dataIns: [], dataOuts: [["attempt", "number"], ["error", "string"]], main: true }),
    same("Retry defaults to 3 attempts and asks for at least 1", [ui("retry").defaultConfig, pick(ui("retry"), "configSchema", "properties", "maxAttempts")], [{ maxAttempts: 3 }, { type: "number", minimum: 1 }]),
    same("Delay", [ports("delay").main, ui("delay").defaultConfig, pick(ui("delay"), "configSchema", "properties", "ms")], [true, { ms: 1000 }, { type: "number", title: "Delay (ms)", minimum: 0 }]),
    same("Set variable", [ports("setVariable").dataOuts, ui("setVariable").defaultConfig], [[["value", null]], { name: "var", value: null }]),
  ];
}
