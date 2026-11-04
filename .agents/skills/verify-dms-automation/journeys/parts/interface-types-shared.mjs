/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

/**
 * @param {Row[]} rows Library rows
 * @param {string} id A type id
 * @returns {Row} The row, empty when absent
 */
export function byId(rows, id) {
  return rows.find((row) => row.id === id) ?? {};
}

/**
 * @param {string[]} ids Listed ids
 * @param {string} id An id
 * @returns {number} How many times it is listed
 */
export function times(ids, id) {
  return ids.filter((candidate) => candidate === id).length;
}
