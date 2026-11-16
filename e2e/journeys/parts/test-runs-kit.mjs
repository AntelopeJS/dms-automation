import { action, chain, trigger } from "../../procs.mjs";
import { auto } from "../../auto.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../procs.mjs").Graph} Graph */

export const NEEDS_CONFIRM = "the draft has steps a test runs for real: confirm them first";

/**
 * A Manual trigger followed by the given actions, in order, each with its settings and optional step name.
 *
 * @param {[string, string, Record<string, unknown>?, string?][]} specs Node id, action type, settings, step name
 * @returns {Graph} The graph
 */
export function steps(specs) {
  const nodes = [
    trigger("t", "manual"),
    ...specs.map(([id, typeId, config = {}, label]) => {
      const node = action(id, typeId, config);
      return label ? { ...node, label } : node;
    }),
  ];
  return chain(nodes);
}

/**
 * Tests a draft on a procedure.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @param {Graph} draft The draft
 * @param {Record<string, unknown>} [extra] More body fields
 * @returns {Promise<import("../../auto.mjs").Answer>} The answer
 */
export function test(ctx, id, draft, extra = {}) {
  return auto(ctx, "test run", "POST", `/procedures/${id}/test`, { body: { graph: draft, ...extra } });
}
