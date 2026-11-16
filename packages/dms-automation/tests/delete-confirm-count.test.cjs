const assert = require("node:assert/strict");
const { test } = require("node:test");

/** @typedef {{ procedureId: string, kind: string, startedAt: Date }} Row */

/**
 * A row proxy that evaluates the comparisons the model builds against one
 * stored row.
 * @param {Row} row
 */
function proxyOf(row) {
  /** @param {unknown} value */
  const valueOf = (value) => {
    /** @type {Record<string, (other: any) => unknown>} */
    const value_ = {
      eq: (other) => valueOf(value === other),
      ne: (other) => valueOf(value !== other),
      ge: (other) => valueOf(value >= other),
      and: (other) => valueOf(value && other.raw),
    };
    return Object.assign(value_, { raw: value });
  };
  return { key: (/** @type {keyof Row} */ name) => valueOf(row[name]) };
}

/** @type {Row[]} */
let stored = [];
const database = {
  table: () => ({
    filter: (/** @type {(row: unknown) => { raw: boolean }} */ keep) => ({
      count: () => ({
        run: async () => stored.filter((r) => keep(proxyOf(r)).raw).length,
      }),
    }),
  }),
};

const {
  ProcedureRunModel,
} = require("../dist/db/models/procedure_run.model.js");

const SINCE = new Date("2026-11-09T12:00:00Z");
const at = (/** @type {string} */ iso) => new Date(iso);

/** The count the delete dialog gave before: read the window, keep in JS. */
async function oldCount(/** @type {string} */ id) {
  const window = stored.filter((r) => r.startedAt >= SINCE);
  return window.filter((r) => r.procedureId === id && r.kind !== "test").length;
}

void test("the delete dialog counts one procedure's production runs in the query, as the JS count did", async () => {
  stored = [
    { procedureId: "P1", kind: "run", startedAt: at("2026-11-10T00:00:00Z") },
    { procedureId: "P1", kind: "rerun", startedAt: SINCE },
    { procedureId: "P1", kind: "test", startedAt: at("2026-11-10T00:00:00Z") },
    { procedureId: "P1", kind: "run", startedAt: at("2026-11-09T11:59:59Z") },
    { procedureId: "P2", kind: "run", startedAt: at("2026-11-10T00:00:00Z") },
    { procedureId: "P2", kind: "rerun", startedAt: at("2026-11-10T01:00:00Z") },
  ];
  const model = new ProcedureRunModel(database);
  for (const id of ["P1", "P2", "P3"]) {
    assert.equal(
      await model.countForStats({ from: SINCE, procedureId: id }),
      await oldCount(id),
      id,
    );
  }
  assert.equal(
    await model.countForStats({ from: SINCE, procedureId: "P1" }),
    2,
  );
});
