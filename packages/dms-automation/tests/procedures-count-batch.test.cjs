const assert = require("node:assert/strict");
const { test } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");
const { Logging } = require("@antelopejs/interface-core/logging");
const { countQueries } = require("../dist/data/procedures-query.js");

/**
 * @typedef {Pick<
 *   import("../dist/db/models/stats.model.js").ProcedureSummaryRow,
 *   "name" | "description" | "status" | "lastError" | "triggerTypes" | "triggers"
 * >} FixtureRow
 */

/**
 * @param {string} name
 * @param {FixtureRow["status"]} status
 * @param {string[]} [triggerTypes]
 * @returns {FixtureRow}
 */
function row(name, status, triggerTypes = ["webhook"]) {
  return {
    name,
    description: "",
    status,
    triggerTypes,
    triggers: [],
    lastError: null,
  };
}

/**
 * A `query` value as the DMS table view encodes one counter.
 * @param {string} id
 * @param {Record<string, string>} query
 */
function entry(id, query) {
  return `${encodeURIComponent(id)}?${new URLSearchParams(query).toString()}`;
}

const ROWS = [
  row("Invoices", "failing"),
  row("Nightly export", "healthy", ["schedule"]),
  row("Welcome mail", "healthy"),
  row("Draft", "draft"),
];

void test("the procedures page registers without the missing count/batch warning", (t) => {
  const warn = t.mock.method(Logging, "Warn", () => {});
  require("../dist/pages/procedures.js");
  const countBatchWarnings = warn.mock.calls.filter((call) =>
    String(call.arguments[0]).includes("count/batch"),
  );
  assert.deepEqual(countBatchWarnings, []);
});

void test("each tab counter counts the rows its own query keeps", () => {
  assert.deepEqual(
    countQueries(ROWS, [
      entry("tab:failing", { filter_status: "is:failing" }),
      entry("tab:healthy", { filter_status: "is:healthy" }),
      entry("tab:healthy webhook", {
        filter_status: "is:healthy",
        filter_triggerTypes: "is:webhook",
      }),
      entry("search", { search: "mail" }),
      entry("all", {}),
    ]),
    {
      "tab:failing": 1,
      "tab:healthy": 2,
      "tab:healthy webhook": 1,
      search: 1,
      all: 4,
    },
  );
});

void test("a malformed or oversized batch is a 400", () => {
  /** @param {string[]} entries */
  const statusOf = (entries) => {
    try {
      countQueries(ROWS, entries);
    } catch (error) {
      assert.ok(error instanceof HTTPResult);
      return error.getStatus();
    }
    assert.fail("the batch was accepted");
  };
  assert.equal(statusOf(["no-separator"]), 400);
  assert.equal(statusOf(["%E0%A4%A?filter_status=is:failing"]), 400);
  assert.equal(
    statusOf(Array.from({ length: 51 }, (_, i) => entry(`${i}`, {}))),
    400,
  );
});
