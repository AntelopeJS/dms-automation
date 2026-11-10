const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Schema } = require("@antelopejs/interface-database");

Schema.get = () => ({
  instance: () => ({
    table: () => ({ orderBy: () => ({ run: async () => [] }) }),
  }),
});

const {
  ProcedureRunModel,
} = require("../dist/db/models/procedure_run.model.js");
const { loadStatsContext } = require("../dist/db/models/stats.model.js");

const DAY = 86_400_000;
const NOW = new Date("2026-11-10T12:00:00Z");
const daysAgo = (/** @type {number} */ days) =>
  new Date(NOW.getTime() - days * DAY);

/**
 * @param {string} id
 * @param {number} days
 * @returns {import("../dist/db/models/procedure_run.model.js").StatsRun}
 */
const runAt = (id, days) => ({
  _id: id,
  procedureId: "P1",
  procedureName: "Invoices",
  startedAt: daysAgo(days),
  endedAt: daysAgo(days),
  status: "ok",
  errorMessage: null,
  kind: "run",
  failedNodeId: null,
  triggerNodeId: "start",
});

const STORED = [runAt("recent", 1), runAt("old", 45)];

/** @type {Array<{ since: Date, answer: PromiseWithResolvers<void> }>} */
const reads = [];
ProcedureRunModel.prototype.listForStats = async (since) => {
  const seen = STORED.filter((r) => r.startedAt >= since);
  /** @type {PromiseWithResolvers<void>} */
  const answer = Promise.withResolvers();
  reads.push({ since, answer });
  await answer.promise;
  return seen;
};

/** @param {number} count */
async function readsStarted(count) {
  for (let i = 0; i < 200 && reads.length < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(reads.length, count, "reads started");
}

/** @param {number} count */
async function answerReads(count) {
  await readsStarted(count);
  for (const read of reads) read.answer.resolve();
}

/** @param {Awaited<ReturnType<typeof loadStatsContext>>} ctx */
const idsOf = (ctx) => ctx.runs.map((r) => r._id);

void test("the stats answers asked together read the runs once", async () => {
  reads.length = 0;
  const asked = [
    loadStatsContext(undefined, NOW),
    loadStatsContext(daysAgo(7), NOW),
    loadStatsContext(daysAgo(14), NOW),
  ];
  await answerReads(1);

  for (const ctx of await Promise.all(asked)) {
    assert.deepEqual(idsOf(ctx), ["recent"]);
  }
  assert.equal(reads.length, 1);
});

void test("an answer that needs older runs widens the read it joins, and the others keep their window", async () => {
  reads.length = 0;
  const usual = loadStatsContext(undefined, NOW);
  const wide = loadStatsContext(daysAgo(60), NOW);
  await answerReads(1);

  assert.deepEqual(idsOf(await usual), ["recent"]);
  assert.deepEqual(idsOf(await wide), ["recent", "old"]);
  assert.equal(reads.length, 1);
});

void test("an answer asked once the read started sees the runs stored since", async (t) => {
  reads.length = 0;
  const first = loadStatsContext(undefined, NOW);
  await readsStarted(1);
  STORED.unshift(runAt("stored-meanwhile", 0));
  t.after(() => void STORED.shift());
  const second = loadStatsContext(undefined, NOW);
  await answerReads(2);

  assert.deepEqual(idsOf(await first), ["recent"]);
  assert.deepEqual(idsOf(await second), ["stored-meanwhile", "recent"]);
});
