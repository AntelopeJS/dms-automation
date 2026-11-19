import { readFileSync } from "node:fs";
import { join } from "node:path";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

export const MODULE = "packages/dms-automation";
export const INTERFACE = "packages/interface-dms-automation";

/**
 * @param {Ctx} ctx The journey
 * @returns {string} The checkout's root
 */
export function repoOf(ctx) {
  return String(ctx.state.repo);
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} path A path under the checkout
 * @returns {string} Its text
 */
export function read(ctx, path) {
  return readFileSync(join(repoOf(ctx), path), "utf8");
}
