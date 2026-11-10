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

/**
 * Node's own `Module._load`, captured before a test replaces it, for the
 * stand-in loaders that fall through to the real one.
 */
module.exports = { load };
