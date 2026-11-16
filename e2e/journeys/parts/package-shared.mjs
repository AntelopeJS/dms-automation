import { join } from "node:path";
import { isRow, isText } from "../../auto.mjs";
import { INTERFACE, MODULE, filesBelow, readJson, repoOf } from "./package-files.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Check} Check */
/** @typedef {Record<string, unknown>} Json */

export const SKILL_PACKAGES = [
  { folder: MODULE, skill: "dms-automation" },
  { folder: INTERFACE, skill: "dms-automation-interface" },
];

/**
 * @param {Ctx} ctx The journey
 * @param {string} folder The package folder
 * @returns {Json} Its package.json
 */
export function manifestOf(ctx, folder) {
  return readJson(ctx, `${folder}/package.json`);
}

/**
 * @param {unknown} value Any value
 * @returns {Json} The value as an object, empty for anything else
 */
export function obj(value) {
  return isRow(value) ? value : {};
}

/**
 * The export targets a manifest names, as paths relative to the package.
 *
 * @param {Json} manifest The package.json
 * @returns {string[]} The targets that have no `*`
 */
export function exportTargets(manifest) {
  /** @type {string[]} */
  const targets = [];
  /** @param {unknown} value */
  const walk = (value) => {
    if (isText(value)) targets.push(value);
    else for (const inner of Object.values(obj(value))) walk(inner);
  };
  walk(manifest.exports);
  return targets.filter((target) => !target.includes("*")).map((target) => target.replace(/^\.\//, ""));
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} path A path under the checkout
 * @returns {boolean} Whether it is a folder
 */
export function statDirectory(ctx, path) {
  return filesBelow(join(repoOf(ctx), path)).length > 0;
}

/**
 * @param {unknown} value Any value
 * @returns {string[]} The elements as text when it is an array, else none
 */
export function strings(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * The code-unit order `Array.prototype.sort` uses by default, as a comparator.
 *
 * @param {unknown} left A value
 * @param {unknown} right Another value
 * @returns {number} Negative, zero or positive
 */
export function byText(left, right) {
  const a = String(left);
  const b = String(right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
