import { check, same } from "../../auto.mjs";
import { action, chain, dedge, flow, graph, tedge, trigger } from "../../procs.mjs";
import { endedAs, inputValue, ranOrder, runGraph, stepsOfNode, userMessages } from "./runtime-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/** What `If` reads as true or false: JavaScript truthiness, except the texts "false" and "0", and empty text, are false. */
export const IF_CASES = [
  { label: "true", cond: true, taken: true },
  { label: "false", cond: false, taken: false },
  { label: "text false", cond: "false", taken: false },
  { label: "text FALSE", cond: "FALSE", taken: false },
  { label: "text padded False", cond: "  False  ", taken: false },
  { label: "text 0", cond: "0", taken: false },
  { label: "empty text", cond: "", taken: false },
  { label: "blank text", cond: "   ", taken: false },
  { label: "text true", cond: "true", taken: true },
  { label: "text no", cond: "no", taken: true },
  { label: "text 1", cond: "1", taken: true },
  { label: "number 0", cond: 0, taken: false },
  { label: "number 1", cond: 1, taken: true },
  { label: "number minus 1", cond: -1, taken: true },
  { label: "null", cond: null, taken: false },
  { label: "empty list", cond: [], taken: true },
  { label: "empty object", cond: {}, taken: true },
  { label: "unicode text", cond: "日本語", taken: true },
];

/**
 * One run holding an If per case, all started by the trigger, each with a Log on `then` and one on `else`.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("./runtime-kit.mjs").Ran>} The run
 */
export async function ifRun(ctx) {
  const nodes = [trigger("t")];
  const edges = [];
  IF_CASES.forEach((one, index) => {
    nodes.push(flow(`if${index}`, "if", { cond: one.cond }));
    nodes.push(action(`then${index}`, "log.message", { message: `then ${one.label}` }));
    nodes.push(action(`else${index}`, "log.message", { message: `else ${one.label}` }));
    edges.push(tedge("t", `if${index}`), tedge(`if${index}`, `then${index}`, "then"), tedge(`if${index}`, `else${index}`, "else"));
  });
  return runGraph(ctx, graph(nodes, edges));
}

/**
 * @param {import("./runtime-kit.mjs").Ran} ran The run of `ifRun`
 * @returns {import("../../auto.mjs").Check[]} The checks
 */
export function ifChecks(ran) {
  const checks = [endedAs("the run", ran, "ok")];
  IF_CASES.forEach((one, index) => {
    const taken = one.taken ? "then" : "else";
    const other = one.taken ? "else" : "then";
    checks.push(same(`${one.label}: the If follows ${taken}`, stepsOfNode(ran, `if${index}`)[0]?.branch, taken));
    checks.push(check(`${one.label}: the ${taken} step runs and the ${other} step does not`, stepsOfNode(ran, `${taken}${index}`).length === 1 && stepsOfNode(ran, `${other}${index}`).length === 0, ranOrder(ran).join(",")));
  });
  checks.push(check("each If logs the branch it took", IF_CASES.every((one, index) => ran.entries.some((entry) => entry.nodeId === `if${index}` && entry.message === `branch: ${one.taken ? "then" : "else"}`)), "see the run's logs"));
  return checks;
}

/** The cases of a Switch (`cases` is what the Switch lists) and which branch each value takes. */
export const SWITCH_CASES = ["a", "b", "1", "1.5", "true", "null", '{"k":1}', "[1,2]", "café", "日本語", "🚀", "A"];

export const SWITCH_VALUES = [
  { label: "text a", value: "a", branch: "a" },
  { label: "text b", value: "b", branch: "b" },
  { label: "text c has no case", value: "c", branch: "default" },
  { label: "text A is another case than a", value: "A", branch: "A" },
  { label: "text AA", value: "AA", branch: "default" },
  { label: "number 1 by its text", value: 1, branch: "1" },
  { label: "number 1.5 by its text", value: 1.5, branch: "1.5" },
  { label: "number 2 has no case", value: 2, branch: "default" },
  { label: "boolean true by its text", value: true, branch: "true" },
  { label: "boolean false has no case", value: false, branch: "default" },
  { label: "null by its text", value: null, branch: "null" },
  { label: "object by its JSON text", value: { k: 1 }, branch: '{"k":1}' },
  { label: "object with another value", value: { k: 2 }, branch: "default" },
  { label: "list by its JSON text", value: [1, 2], branch: "[1,2]" },
  { label: "list in another order", value: [2, 1], branch: "default" },
  { label: "accented text", value: "café", branch: "café" },
  { label: "CJK text", value: "日本語", branch: "日本語" },
  { label: "emoji text", value: "🚀", branch: "🚀" },
  { label: "text with a trailing space", value: "a ", branch: "default" },
];

/**
 * One run holding a Switch per value, each listing `SWITCH_CASES`, with a Log on every case and on `default`.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("./runtime-kit.mjs").Ran>} The run
 */
export async function switchRun(ctx) {
  const nodes = [trigger("t")];
  const edges = [];
  SWITCH_VALUES.forEach((one, index) => {
    nodes.push(flow(`sw${index}`, "switch", { cases: SWITCH_CASES, value: one.value }));
    edges.push(tedge("t", `sw${index}`));
    for (const name of [...SWITCH_CASES, "default"]) {
      nodes.push(action(`sw${index}-${name}`, "log.message", { message: `${one.label} -> ${name}` }));
      edges.push(tedge(`sw${index}`, `sw${index}-${name}`, name));
    }
  });
  return runGraph(ctx, graph(nodes, edges));
}

/**
 * @param {import("./runtime-kit.mjs").Ran} ran The run of `switchRun`
 * @returns {import("../../auto.mjs").Check[]} The checks
 */
export function switchChecks(ran) {
  const checks = [endedAs("the run", ran, "ok")];
  SWITCH_VALUES.forEach((one, index) => {
    const ranBranches = [...SWITCH_CASES, "default"].filter((name) => stepsOfNode(ran, `sw${index}-${name}`).length > 0);
    checks.push(same(`${one.label}: the only branch that runs`, ranBranches, [one.branch]));
    checks.push(same(`${one.label}: the Switch records its branch`, stepsOfNode(ran, `sw${index}`)[0]?.branch, one.branch));
  });
  return checks;
}

/**
 * A Switch with no case at all and one whose value is wired from a data node.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function switchWiredAndEmpty(ctx) {
  const wired = chain(
    [trigger("t"), flow("s", "switch", { cases: ["x", "y"] }), action("lx", "log.message", { message: "x" }), action("ly", "log.message", { message: "y" }), action("ld", "log.message", { message: "default" })],
    [],
  );
  wired.triggerEdges = [tedge("t", "s"), tedge("s", "lx", "x"), tedge("s", "ly", "y"), tedge("s", "ld", "default")];
  wired.nodes.push({ id: "c", kind: "data", typeId: "string.concat", config: { a: "x", b: "" }, position: { x: 0, y: 0 } });
  wired.dataEdges = [dedge("c", "result", "s", "value")];
  const ranWired = await runGraph(ctx, wired);
  const empty = graph([trigger("t"), flow("s", "switch", { cases: [], value: "x" }), action("ld", "log.message", { message: "default" })], [tedge("t", "s"), tedge("s", "ld", "default")]);
  const ranEmpty = await runGraph(ctx, empty);
  return [
    endedAs("the wired Switch run", ranWired, "ok"),
    same("a value wired from Join text selects its case", userMessages(ranWired), ["branch: x", "x"]),
    same("the wired input is the Switch's value", inputValue(stepsOfNode(ranWired, "s")[0], "value"), "x"),
    endedAs("the Switch without cases run", ranEmpty, "ok"),
    same("a Switch without cases always takes default", userMessages(ranEmpty), ["branch: default", "default"]),
  ];
}
