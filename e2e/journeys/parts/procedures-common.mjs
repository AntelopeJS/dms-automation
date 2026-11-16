import { auto, check, isRow, isText, list, num, pick, same, text } from "../../auto.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

export const EMPTY_GRAPH = { nodes: [], triggerEdges: [], dataEdges: [] };

/**
 * The saved procedure as `GET /procedures/:id` serves it.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @returns {Promise<Row>} The procedure, empty when it is not found
 */
export async function procedureOf(ctx, id) {
  const answer = await auto(ctx, `read procedure ${id.slice(0, 8)}`, "GET", `/procedures/${id}`);
  return isRow(answer.body) ? answer.body : {};
}

/**
 * The summary row of a procedure, as the Procedures list reads it.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @returns {Promise<Row>} The row, empty when there is none
 */
export async function summaryOf(ctx, id) {
  const answer = await auto(ctx, "read the summary", "GET", "/procedures/summary");
  return list(answer.body).find((row) => row.procedureId === id) ?? {};
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<number>} How many procedures exist
 */
export async function procedureCount(ctx) {
  const answer = await auto(ctx, "count the procedures", "GET", "/procedures?limit=1");
  return num(answer.body, "total") ?? -1;
}

/**
 * The checks of a refused request body: 400 with the module's `invalid body` shape naming the field.
 *
 * @param {import("../../auto.mjs").Answer} answer The answer
 * @param {string} label What was sent
 * @param {string[]} path The path of the first issue
 * @returns {import("../../auto.mjs").Check[]} The checks
 */
export function refusedBody(answer, label, path) {
  return [
    same(`${label}: status`, answer.status, 400),
    same(`${label}: error`, pick(answer.body, "error"), "invalid body"),
    same(`${label}: message key`, pick(answer.body, "message"), "$dms_automation.api.invalidBody"),
    same(`${label}: first issue path`, list(answer.body, "issues")[0]?.path, path),
  ];
}

/**
 * The checks of a 404 for a procedure that does not exist.
 *
 * @param {import("../../auto.mjs").Answer} answer The answer
 * @param {string} label What was asked
 * @param {string} id The id asked for
 * @returns {import("../../auto.mjs").Check[]} The checks
 */
export function notFound(answer, label, id) {
  return [
    same(`${label}: status`, answer.status, 404),
    same(`${label}: error`, text(answer.body, "error"), `procedure "${id}" not found`),
    same(`${label}: message key`, text(answer.body, "message"), "$dms_automation.api.notFound"),
  ];
}

/**
 * @param {string} name What is checked
 * @param {unknown} actual The value
 * @param {RegExp} pattern What it should match
 * @returns {import("../../auto.mjs").Check} The check
 */
export function matches(name, actual, pattern) {
  return check(name, isText(actual) && pattern.test(actual), actual);
}
