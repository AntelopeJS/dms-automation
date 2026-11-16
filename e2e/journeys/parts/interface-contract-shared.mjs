import { auto, isRow, list, parseJson, text } from "../../auto.mjs";
import { ledger } from "../../procs.mjs";
import { actionNode, chainGraph, triggerNode } from "./interface-calls.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

/**
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @returns {Promise<Row>} The procedure's row of the list, with its arming errors parsed
 */
export async function armErrorsOf(ctx, id) {
  const answer = await auto(ctx, "the procedures", "GET", "/procedures");
  const row = list(answer.body, "results").find((candidate) => candidate._id === id) ?? {};
  const errors = parseJson(text(row, "armErrors") || "{}");
  return isRow(errors) ? errors : {};
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} kind A ledger kind
 * @returns {Promise<Row[]>} The ledger entries of that kind
 */
export async function entriesOf(ctx, kind) {
  return (await ledger(ctx)).entries.filter((entry) => entry.kind === kind);
}

/**
 * @param {string} topic The topic
 * @param {string} typeId The trigger type
 * @param {string} message The log message
 * @returns {Row} A graph that logs when the fixture trigger fires
 */
export function eventGraph(topic, typeId, message) {
  return chainGraph([triggerNode("ev", typeId, { topic }), actionNode("log", "log.message", { message })]);
}
