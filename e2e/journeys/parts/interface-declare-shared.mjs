import { auto, isRow } from "../../auto.mjs";
import { logGraph } from "./interface-calls.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

export const PREFIX = "[dms-automation] DeclareProcedure";

/**
 * @param {string} id The declaration's id
 * @param {Row} [fields] Fields that replace the defaults
 * @returns {Row} A declaration of a Manual trigger and a Log action, disabled
 */
export function declaration(id, fields = {}) {
  return {
    id,
    name: `Declared ${id}`.slice(0, 200),
    graph: logGraph("declared"),
    enabled: false,
    ...fields,
  };
}

/**
 * @param {string} id The id
 * @param {string} problems The problems after `refused: `
 * @returns {string} The rejection's message
 */
export function refusal(id, problems) {
  return `${PREFIX}("${id}") refused: ${problems}`;
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @returns {Promise<Row | null>} The stored procedure, null for a 404
 */
export async function stored(ctx, id) {
  const answer = await auto(ctx, `read ${id.slice(0, 40)}`, "GET", `/procedures/${encodeURIComponent(id)}`);
  return answer.status === 200 && isRow(answer.body) ? answer.body : null;
}
