const { Schema } = require("@antelopejs/interface-database");

/**
 * @typedef {{
 *   _id: string;
 *   procedureId: string;
 *   status: string;
 *   startedAt: Date;
 *   endedAt?: Date;
 *   kind?: string;
 *   durationMs?: number;
 *   procedureName?: string;
 *   errorMessage?: string;
 *   failedNodeId?: string;
 * }} StoredRun
 */

/** What the fake database holds; a test replaces both lists. */
const stored = {
  /** @type {object[]} */
  procedures: [],
  /** @type {StoredRun[]} */
  runs: [],
};

Schema.list = () =>
  new Map([
    [
      "dms_automation",
      {
        instance: () => ({
          table: () => ({
            orderBy: () => ({ run: async () => stored.procedures }),
          }),
        }),
      },
    ],
  ]);

const {
  ProcedureRunModel,
} = require("../../dist/db/models/procedure_run.model.js");

/**
 * @param {import("../../dist/db/models/procedure_run.model.js").StatsQuery} query
 * @returns {(run: StoredRun) => boolean}
 */
const selects = (query) => (run) =>
  run.kind !== "test" &&
  run.startedAt >= query.from &&
  (!query.to || run.startedAt <= query.to) &&
  (!query.after || run.startedAt > query.after) &&
  (!query.procedureId || run.procedureId === query.procedureId) &&
  (!query.status || run.status === query.status) &&
  (!query.exceptStatus || run.status !== query.exceptStatus);

/**
 * @param {import("../../dist/db/models/procedure_run.model.js").StatsQuery} query
 * @returns {StoredRun[]}
 */
const selected = (query) =>
  stored.runs
    .filter(selects(query))
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

/** @param {StoredRun} run */
const durationOf = (run) =>
  run.durationMs ??
  (run.endedAt ? run.endedAt.getTime() - run.startedAt.getTime() : 0);

/**
 * @template T
 * @param {StoredRun[]} runs
 * @param {(run: StoredRun) => T} keyOf
 * @returns {Map<T, StoredRun[]>}
 */
function groupBy(runs, keyOf) {
  /** @type {Map<T, StoredRun[]>} */
  const groups = new Map();
  for (const run of runs) {
    const key = keyOf(run);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return groups;
}

const model = ProcedureRunModel.prototype;
model.newestForStats = async (query, count) => selected(query).slice(0, count);
model.oldestForStats = async (query) => selected(query).at(-1);
model.countForStats = async (query) => selected(query).length;
model.countPerStatus = async (query) =>
  new Map(
    [...groupBy(selected(query), (r) => r.status)].map(([status, runs]) => [
      status,
      runs.length,
    ]),
  );
model.countPerProcedure = async (query) =>
  new Map(
    [...groupBy(selected(query), (r) => r.procedureId)].map(([id, runs]) => [
      id,
      {
        runs: runs.length,
        avgDurationMs:
          runs.reduce((sum, run) => sum + durationOf(run), 0) / runs.length,
      },
    ]),
  );
model.countPerBucket = async (query, first, stepMs) =>
  new Map(
    [
      ...groupBy(selected(query), (r) =>
        Math.floor((r.startedAt.getTime() - first.getTime()) / stepMs),
      ),
    ].map(([bucket, runs]) => [bucket, runs.length]),
  );
model.timingsForStats = async (query) => selected(query);

/**
 * Hold these procedures and runs, as the stats reads find them.
 * @param {object[]} procedures
 * @param {StoredRun[]} runs
 */
function store(procedures, runs) {
  stored.procedures = procedures;
  stored.runs = runs;
}

module.exports = { store };
