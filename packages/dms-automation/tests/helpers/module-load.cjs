const Module = require("node:module");

/**
 * @param {unknown} value
 * @returns {value is (this: unknown, request: string, ...rest: unknown[]) => unknown}
 */
function isLoader(value) {
  return value instanceof Function;
}

/** @type {unknown} */
const load = Module._load;
if (!isLoader(load))
  throw new Error("Module._load is not available in this Node");

module.exports = { load };
