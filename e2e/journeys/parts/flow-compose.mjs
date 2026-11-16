import { check, same, text } from "../../auto.mjs";
import { action, data, dedge, flow, graph, tedge, trigger } from "../../procs.mjs";
import { endedAs, inputValue, ranOrder, runGraph, stepsOfNode, userMessages } from "./runtime-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * Flow nodes nested: a loop whose body branches on each item, inside a Try / Catch, then a step on main.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function composeChecks(ctx) {
  const ran = await runGraph(
    ctx,
    graph(
      [
        trigger("t"),
        flow("tc", "tryCatch"),
        flow("each", "foreach", { items: [false, true, false, true] }),
        flow("branch", "if"),
        action("hi", "log.message", { message: "big" }),
        action("lo", "log.message", { message: "small" }),
        action("end", "log.message", { message: "end" }),
      ],
      [tedge("t", "tc"), tedge("tc", "each", "try"), tedge("each", "branch", "body"), tedge("branch", "hi", "then"), tedge("branch", "lo", "else"), tedge("tc", "end")],
      [dedge("each", "value", "branch", "cond")],
    ),
  );
  const branches = stepsOfNode(ran, "branch").map((step) => [step.iteration, step.branch]);
  return [
    endedAs("the run", ran, "ok"),
    same("each item takes its own branch", branches, [[0, "else"], [1, "then"], [2, "else"], [3, "then"]]),
    same("the logs are in item order, then the end", userMessages(ran).filter((message) => !message.startsWith("branch: ")), ["small", "big", "small", "big", "end"]),
    same("steps inside the loop sit one level down", [stepsOfNode(ran, "each")[0]?.depth, stepsOfNode(ran, "branch")[0]?.depth], [1, 2]),
    same("the loop is the parent of the branch step", text(stepsOfNode(ran, "branch")[0], "port"), "body"),
    check("the step on main runs last", ranOrder(ran).at(-1) === "end", ranOrder(ran).join(",")),
  ];
}

/**
 * A failing step stops the run: later steps do not run, the run names the failed node.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function failureStopsChecks(ctx) {
  const ran = await runGraph(
    ctx,
    graph(
      [trigger("t"), action("a", "log.message", { message: "first" }), action("boom", "verify.fail", { message: "stop here" }), action("c", "log.message", { message: "never" })],
      [tedge("t", "a"), tedge("a", "boom"), tedge("boom", "c")],
    ),
  );
  return [
    endedAs("the run", ran, "failed"),
    same("the error", ran.error, "stop here"),
    same("the failed node", ran.failedNodeId, "boom"),
    same("steps that ran", ranOrder(ran), ["t", "a", "boom"]),
    same("the failed step carries the error", text(stepsOfNode(ran, "boom")[0], "error"), "stop here"),
  ];
}

/**
 * A data node wired from a loop's value is evaluated again for every iteration.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function loopDataChecks(ctx) {
  const ran = await runGraph(
    ctx,
    graph(
      [trigger("t"), flow("each", "foreach", { items: [1, 5, 9] }), data("plus", "math.add", { b: 100 }), flow("branch", "if"), data("big", "compare.gt", { b: 3 }), action("hi", "log.message", { message: "big" }), action("lo", "log.message", { message: "small" }), action("show", "log.message", {})],
      [tedge("t", "each"), tedge("each", "show", "body"), tedge("show", "branch"), tedge("branch", "hi", "then"), tedge("branch", "lo", "else")],
      [dedge("each", "value", "plus", "a"), dedge("plus", "result", "show", "value"), dedge("each", "value", "big", "a"), dedge("big", "result", "branch", "cond")],
    ),
  );
  return [
    endedAs("the run", ran, "ok"),
    same("Add reads the item of each iteration", stepsOfNode(ran, "show").map((step) => inputValue(step, "value")), [101, 105, 109]),
    same("Greater than reads the item of each iteration", stepsOfNode(ran, "branch").map((step) => step.branch), ["else", "then", "then"]),
  ];
}
