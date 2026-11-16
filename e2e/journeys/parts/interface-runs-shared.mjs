import { text } from "../../auto.mjs";
import { runOf } from "../../procs.mjs";
import { actionNode, runProcedure, stepOf, triggerNode, valueOf } from "./interface-calls.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

/**
 * A graph with two triggers, `t1` (manual) and `t2` (a fixture trigger that is never armed), both leading to a Log.
 *
 * @returns {Row} The graph
 */
export function twoTriggerGraph() {
  return {
    nodes: [triggerNode("t1"), triggerNode("t2", "verify.event", { topic: "never-armed" }), actionNode("log", "log.message", { message: "two" })],
    triggerEdges: [
      { id: "e1", from: { node: "t1" }, to: { node: "log" } },
      { id: "e2", from: { node: "t2" }, to: { node: "log" } },
    ],
    dataEdges: [],
  };
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @param {unknown} options The RunProcedure options
 * @returns {Promise<{ payload: unknown, trigger: unknown, status: unknown }>} What the run's trigger step received
 */
export async function ranWith(ctx, id, options) {
  const outcome = await runProcedure(ctx, id, options);
  const run = await runOf(ctx, text(outcome.result, "runId"));
  return {
    payload: valueOf(stepOf(run, text(run, "triggerNodeId")).output),
    trigger: run.triggerNodeId,
    status: outcome.result.status,
  };
}
