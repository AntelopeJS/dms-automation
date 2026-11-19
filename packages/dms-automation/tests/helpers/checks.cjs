const assert = require("node:assert/strict");

/**
 * @typedef {{ kind: "check", name: string, pass: boolean, detail: string }} Check
 * @typedef {{ kind: "same", name: string, actual: unknown, expected: unknown }} Same
 */

/**
 * @param {unknown} value Any value
 * @returns {value is string} Whether it is a string
 */
function isText(value) {
  return typeof value === "string";
}

/**
 * @param {unknown} value Any value
 * @returns {value is Record<string, unknown>} Whether it is an object
 */
function isRow(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value Any value
 * @returns {unknown} Its JSON value, or undefined when it is not JSON text
 */
function parseJson(value) {
  try {
    return JSON.parse(String(value));
  } catch {
    return undefined;
  }
}

/**
 * @param {unknown} value Any value
 * @param {...string} path Field names, outermost first
 * @returns {unknown} The nested field, undefined when a step is missing
 */
function pick(value, ...path) {
  let current = value;
  for (const step of path) {
    if (!isRow(current)) return undefined;
    current = current[step];
  }
  return current;
}

/**
 * @param {unknown} value Any value
 * @param {...string} path Field names, outermost first
 * @returns {string} The field when it is text, else the empty string
 */
function text(value, ...path) {
  const found = pick(value, ...path);
  return isText(found) ? found : "";
}

/**
 * @param {unknown} value Any value
 * @param {...string} path Field names, outermost first
 * @returns {Record<string, unknown>[]} The objects of the array field
 */
function list(value, ...path) {
  const found = path.length === 0 ? value : pick(value, ...path);
  return Array.isArray(found) ? found.filter(isRow) : [];
}

/**
 * @param {string} name What is checked
 * @param {unknown} pass Whether it holds
 * @param {unknown} detail What was observed
 * @returns {Check} The check
 */
function check(name, pass, detail) {
  return {
    kind: "check",
    name,
    pass: pass === true,
    detail: isText(detail) ? detail : (JSON.stringify(detail) ?? "undefined"),
  };
}

/**
 * @param {string} name What is compared
 * @param {unknown} actual What was observed
 * @param {unknown} expected What the docs say
 * @returns {Same} The comparison
 */
function same(name, actual, expected) {
  return { kind: "same", name, actual, expected };
}

/**
 * @param {unknown} value Any value
 * @returns {unknown} What the value reads as once serialised to JSON, undefined kept apart from null
 */
function jsonValue(value) {
  const json = JSON.stringify(value);
  return json === undefined ? { undefined: true } : JSON.parse(json);
}

/**
 * Runs each check as a subtest named `<step> > <check>`.
 *
 * @param {import("node:test").TestContext} t The running test
 * @param {string} step What the checks are about
 * @param {(Check | Same)[]} checks The checks
 * @returns {Promise<void>}
 */
async function assertChecks(t, step, checks) {
  for (const entry of checks) {
    await t.test(`${step} > ${entry.name}`, () => {
      if (entry.kind === "same") {
        assert.deepEqual(
          jsonValue(entry.actual),
          jsonValue(entry.expected),
          entry.name,
        );
        return;
      }
      assert.ok(entry.pass, `${entry.name}: ${entry.detail}`);
    });
  }
}

module.exports = {
  check,
  isRow,
  isText,
  list,
  parseJson,
  pick,
  same,
  text,
  assertChecks,
};
