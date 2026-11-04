import { check, same } from "../../auto.mjs";
import { action, dedge, flow, graph, tedge, trigger } from "../../procs.mjs";
import { endedAs, outputValue, runGraph, stepsOfNode, userLogs } from "./runtime-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * A loop (`foreach` or `forRange`) whose body logs the loop's value and index, followed by a Log on `main`.
 *
 * @param {string} kind The loop kind
 * @param {import("../../auto.mjs").Row} config The loop's settings
 * @returns {import("../../procs.mjs").Graph} The graph
 */
export function loopGraph(kind, config) {
  return graph(
    [trigger("t"), flow("loop", kind, config), action("body", "log.message", { message: "body" }), action("after", "log.message", { message: "after" })],
    [tedge("t", "loop"), tedge("loop", "body", "body"), tedge("loop", "after")],
    [dedge("loop", "value", "body", "value"), dedge("loop", "index", "body", "message")],
  );
}

/**
 * The (index, value) pairs the body received, then whether `after` ran, in log order.
 *
 * @param {import("./runtime-kit.mjs").Ran} ran The run
 * @returns {unknown[]} Each iteration as `[index, value]`, with "after" last when the main branch ran
 */
export function iterations(ran) {
  const out = [];
  for (const step of ran.steps) {
    if (step.nodeId === "body") out.push([step.inputs?.message?.value, step.inputs?.value?.value]);
    if (step.nodeId === "after") out.push("after");
  }
  return out;
}

/** For each: items, and what the body receives. */
export const FOREACH_LISTS = [
  { label: "three texts", items: ["a", "b", "c"] },
  { label: "accents, CJK and an emoji in order", items: ["café", "日本語", "🚀", "naïve"] },
  { label: "mixed values", items: [1, "1", true, null, { k: [1, 2] }, [3]] },
  { label: "one item", items: ["only"] },
  { label: "an empty list", items: [] },
];

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function foreachChecks(ctx) {
  const checks = [];
  for (const one of FOREACH_LISTS) {
    const ran = await runGraph(ctx, loopGraph("foreach", { items: one.items }));
    const expected = [...one.items.map((item, index) => [index, item]), "after"];
    checks.push(endedAs(one.label, ran, "ok"));
    checks.push(same(`${one.label}: the body runs once per item, in order, then the main branch once`, iterations(ran), expected));
    const iteration = stepsOfNode(ran, "body").map((step) => step.iteration);
    checks.push(same(`${one.label}: the trace numbers the iterations from 0`, iteration, one.items.map((_, index) => index)));
    checks.push(same(`${one.label}: the loop records the last value and index`, outputValue(stepsOfNode(ran, "loop")[0]) ?? null, one.items.length === 0 ? null : { value: one.items.at(-1) ?? null, index: one.items.length - 1 }));
  }
  const notArrays = [
    { label: "text", items: "abc", got: "string" },
    { label: "number", items: 5, got: "number" },
    { label: "object", items: { a: 1 }, got: "object" },
    { label: "null", items: null, got: "object" },
  ];
  for (const one of notArrays) {
    const ran = await runGraph(ctx, loopGraph("foreach", { items: one.items }));
    checks.push(endedAs(`items as ${one.label}`, ran, "ok"));
    checks.push(same(`items as ${one.label}: no iteration, the main branch runs`, iterations(ran), ["after"]));
    checks.push(
      same(`items as ${one.label}: a warning says what it got`, userLogs(ran).filter((entry) => entry.level === "warn").map((entry) => entry.message), [`foreach "items" input is not an array (got ${one.got}); iterating zero times`]),
    );
  }
  const unset = await runGraph(ctx, loopGraph("foreach", {}));
  checks.push(same("no items at all: the warning names undefined", userLogs(unset).filter((entry) => entry.level === "warn").map((entry) => entry.message), ['foreach "items" input is not an array (got undefined); iterating zero times']));
  return checks;
}

/** For range cases: settings and the values the body receives. */
export const RANGE_CASES = [
  { label: "0 to 3", config: { start: 0, end: 3, step: 1 }, values: [0, 1, 2] },
  { label: "the end is not included", config: { start: 1, end: 2, step: 1 }, values: [1] },
  { label: "the step defaults to 1", config: { start: 2, end: 5 }, values: [2, 3, 4] },
  { label: "the start defaults to 0", config: { end: 3 }, values: [0, 1, 2] },
  { label: "no settings at all", config: {}, values: [] },
  { label: "counting down", config: { start: 5, end: 0, step: -2 }, values: [5, 3, 1] },
  { label: "a fractional step", config: { start: 0, end: 1, step: 0.25 }, values: [0, 0.25, 0.5, 0.75] },
  { label: "an empty range", config: { start: 3, end: 3 }, values: [] },
  { label: "a range going the wrong way up", config: { start: 5, end: 0, step: 1 }, values: [] },
  { label: "a range going the wrong way down", config: { start: 0, end: 3, step: -1 }, values: [] },
  { label: "numbers written as text", config: { start: "1", end: "4", step: "1" }, values: [1, 2, 3] },
  { label: "negative numbers", config: { start: -2, end: 1 }, values: [-2, -1, 0] },
];

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function rangeChecks(ctx) {
  const checks = [];
  for (const one of RANGE_CASES) {
    const ran = await runGraph(ctx, loopGraph("forRange", one.config));
    checks.push(endedAs(one.label, ran, "ok"));
    checks.push(
      same(
        `${one.label}: the body gets each value and its index, then main runs`,
        iterations(ran),
        [...one.values.map((value, index) => [index, value]), "after"],
      ),
    );
  }
  const zero = await runGraph(ctx, loopGraph("forRange", { start: 0, end: 3, step: 0 }));
  checks.push(endedAs("step 0", zero, "failed"));
  checks.push(same("step 0: the error", zero.error, "forRange: step must be non-zero"));
  checks.push(same("step 0: the loop is the failed step", zero.failedNodeId, "loop"));
  checks.push(check("step 0: nothing ran after", stepsOfNode(zero, "body").length === 0 && stepsOfNode(zero, "after").length === 0, JSON.stringify(zero.steps.map((s) => s.nodeId))));
  const nan = await runGraph(ctx, loopGraph("forRange", { start: "x", end: 3 }));
  checks.push(endedAs("a start that is not a number", nan, "ok"));
  checks.push(same("a start that is not a number: no iteration, main runs", iterations(nan), ["after"]));
  checks.push(same("a start that is not a number: the warning", userLogs(nan).filter((entry) => entry.level === "warn").map((entry) => entry.message), ["forRange has non-finite input(s) (start=NaN, end=3, step=1); iterating zero times"]));
  return checks;
}

/**
 * The iteration limit: 10000 iterations run, 10001 are refused before the first.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function rangeLimitChecks(ctx) {
  const over = await runGraph(ctx, loopGraph("forRange", { start: 0, end: 10001 }));
  const stepOver = await runGraph(ctx, loopGraph("forRange", { start: 0, end: 20001, step: 2 }));
  const down = await runGraph(ctx, loopGraph("forRange", { start: 10001, end: 0, step: -1 }));
  const edgeGraph = graph([trigger("t"), flow("loop", "forRange", { start: 0, end: 10000 }), action("body", "log.message", { message: "b" })], [tedge("t", "loop"), tedge("loop", "body", "body")]);
  const exact = await runGraph(ctx, edgeGraph);
  const message = "forRange would run 10001 iterations, more than the 10000 allowed";
  return [
    endedAs("10001 iterations", over, "failed"),
    same("10001 iterations: the error", over.error, message),
    check("10001 iterations: refused before the first one", stepsOfNode(over, "body").length === 0, JSON.stringify(over.steps.length)),
    same("10001 iterations by a step of 2: the error", stepOver.error, message),
    same("10001 iterations counting down: the error", down.error, message),
    endedAs("10000 iterations", exact, "ok"),
    same("10000 iterations: the loop ended on the last value and index", outputValue(stepsOfNode(exact, "loop")[0]), { value: 9999, index: 9999 }),
  ];
}
