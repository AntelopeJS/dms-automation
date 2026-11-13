const assert = require("node:assert/strict");
const { test } = require("node:test");
const { GetMetadata } = require("@antelopejs/interface-core");
const { DataAPIMeta } = require("@antelopejs/interface-data-api/metadata");
const { RunsTableAPI } = require("../dist/data/runs-table.js");

/**
 * A stand-in for a database value proxy: every call is written to `calls`,
 * with its arguments, and answers the same proxy.
 */
function recorder() {
  /** @type {unknown[][]} */
  const calls = [];
  /** @type {Record<string, (...args: unknown[]) => unknown>} */
  const proxy = {};
  for (const name of ["key", "default", "match", "and", "not", "eq", "ne"]) {
    proxy[name] = (...args) => {
      calls.push([name, ...args]);
      return proxy;
    };
  }
  return { proxy, calls };
}

/**
 * Runs the filter of the runs table's `field` with `value` and `mode`, and
 * returns what it answered and the calls it made on the field and the row.
 * @param {string} field
 * @param {string | boolean} value
 * @param {string} [mode]
 */
function filter(field, value, mode = "eq") {
  const run = GetMetadata(RunsTableAPI, DataAPIMeta).filters[field];
  assert.ok(run, `the runs table filters ${field}`);
  const { proxy, calls } = recorder();
  const answer = run({}, proxy, field, value, mode, proxy);
  return { answer, calls };
}

void test("a text filter on a run matches the trimmed text, escaped, without case", () => {
  assert.deepEqual(filter("_id", " ab.c ").calls, [["match", "(?i)^ab\\.c"]]);
  assert.deepEqual(filter("triggerSummary", " /hook ").calls, [
    ["key", "path"],
    ["default", ""],
    ["match", "(?i)/hook"],
  ]);
  assert.deepEqual(filter("failedStep", "Send").calls, [
    ["key", "label"],
    ["default", ""],
    ["match", "(?i)Send"],
  ]);
  assert.deepEqual(filter("errorMessage", "404").calls.slice(0, 3), [
    ["key", "errorMessage"],
    ["default", ""],
    ["match", "(?i)404"],
  ]);
  assert.deepEqual(filter("procedureId", " p-1 ").calls, [["eq", "p-1"]]);
  assert.deepEqual(filter("procedureId", "p-1", "is_not").calls, [
    ["ne", "p-1"],
  ]);
  assert.equal(filter("procedureId", "  ").answer, true);
});

void test("a boolean filter value matches no run's text, and compares as it is on the procedure", () => {
  for (const field of ["_id", "triggerSummary", "failedStep", "errorMessage"]) {
    const result = filter(field, true);
    assert.equal(result.answer, false, field);
    assert.ok(
      result.calls.every(([name]) => name !== "match"),
      `${field} builds no pattern from a boolean`,
    );
  }
  assert.deepEqual(filter("procedureId", true).calls, [["eq", true]]);
  assert.deepEqual(filter("procedureId", false, "is_not").calls, [
    ["ne", false],
  ]);
});
