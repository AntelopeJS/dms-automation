const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Schema } = require("@antelopejs/interface-database");

Schema.get = () => ({ instance: () => ({ table: () => ({}) }) });

const { ProcedureModel } = require("../dist/db/models/procedure.model.js");
const {
  ProcedureRunModel,
} = require("../dist/db/models/procedure_run.model.js");
const {
  builtinActions,
  builtinDataNodes,
  builtinTriggers,
} = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { markModuleStarted } = require("../dist/runtime/readiness.js");
const { serializeTriggerPayload } = require("../dist/runtime/boundRunLog.js");
const {
  InvokeProcedure,
  RunProcedure,
} = require("../dist/implementations/dms-automation/index.js");
const {
  isNumber,
  isPropertyBag,
  isString,
} = require("../dist/types/guards.js");

/** @typedef {import("../dist/types/graph.js").GraphNode} GraphNode */
/** @typedef {import("../dist/types/graph.js").TriggerEdge} TriggerEdge */
/** @typedef {import("../dist/db/tables/procedure_run.table.js").ProcedureRun} ProcedureRun */
/** @typedef {import("../dist/db/models/procedure_run.model.js").HistoryQuery} HistoryQuery */
/** @typedef {Partial<ProcedureRun> & { _id: string }} RunRow */
/** @typedef {{ _id: string, name: string, enabled: boolean, graph: string, revision: number, version: number }} StoredProcedure */

for (const t of builtinTriggers) registry.addTrigger(t.id, t);
for (const a of builtinActions) registry.addAction(a.id, a);
for (const d of builtinDataNodes) registry.addDataNode(d.id, d);
markModuleStarted();

/**
 * @param {string} id
 * @param {string} kind
 * @param {string} typeId
 * @param {Record<string, unknown>} [config]
 * @returns {GraphNode}
 */
const node = (id, kind, typeId, config = {}) => ({
  id,
  kind,
  typeId,
  config,
  position: { x: 0, y: 0 },
});
/**
 * @param {string} from
 * @param {string} to
 * @returns {TriggerEdge}
 */
const edge = (from, to) => ({
  id: `${from}-${to}`,
  from: { node: from },
  to: { node: to },
});

/**
 * A schedule and a webhook start it; nothing else does.
 * @type {StoredProcedure}
 */
const scheduled = {
  _id: "reports.weekly",
  name: "Weekly report",
  enabled: true,
  graph: JSON.stringify({
    nodes: [
      node("monday", "trigger", "schedule.cron", { cron: "0 9 * * 1" }),
      node("hook", "trigger", "webhook", { path: "/weekly" }),
      node("log", "action", "log.message", { message: "report" }),
    ],
    triggerEdges: [edge("monday", "log"), edge("hook", "log")],
    dataEdges: [],
  }),
  revision: 1,
  version: 1,
};
/** @type {StoredProcedure} */
const broken = {
  ...scheduled,
  _id: "reports.broken",
  graph: JSON.stringify({ nodes: [], triggerEdges: [], dataEdges: [] }),
};
/** @type {Map<string, StoredProcedure>} */
const procedures = new Map([
  [scheduled._id, scheduled],
  [broken._id, broken],
]);

/** @type {RunRow[]} */
const runs = [];
Object.assign(ProcedureModel.prototype, {
  /** @param {string} id */
  get: async (id) => procedures.get(id),
});
Object.assign(ProcedureRunModel.prototype, {
  /** @param {Partial<ProcedureRun>} row */
  insert: async (row) => {
    const _id = `run-${runs.length + 1}`;
    runs.push({ ...row, _id, startedAt: row.startedAt });
    return [_id];
  },
  /** @param {string} id */
  get: async (id) => runs.find((r) => r._id === id),
  /**
   * @param {string} procedureId
   * @param {HistoryQuery} query
   */
  newest: async (procedureId, { before }) =>
    runs
      .filter(
        (r) =>
          r.procedureId === procedureId &&
          r.kind !== "test" &&
          r.startedAt < before,
      )
      .sort((a, b) => b.startedAt - a.startedAt)[0],
});

/**
 * @param {unknown} err
 * @returns {Record<string, unknown>}
 */
function thrown(err) {
  assert.ok(isPropertyBag(err));
  return err;
}

void test("a procedure without a manual trigger runs from code", async () => {
  await assert.rejects(InvokeProcedure(scheduled._id), (err) => {
    const { body } = thrown(err);
    assert.ok(isString(body));
    assert.match(body, /no manual trigger/);
    return true;
  });

  const outcome = await RunProcedure(scheduled._id, {
    payload: { firedAt: "2026-10-12T09:00:00.000Z" },
  });
  assert.deepEqual(outcome, { runId: "run-1", status: "ok" });
  const [run] = runs;
  assert.equal(run.triggerNodeId, "monday");
  assert.equal(run.kind, "run");
  assert.ok(isString(run.triggerPayload));
  assert.deepEqual(JSON.parse(run.triggerPayload), {
    firedAt: "2026-10-12T09:00:00.000Z",
  });
});

void test("it starts from the trigger named, with its last payload by default", async () => {
  runs.push({
    _id: "earlier",
    procedureId: scheduled._id,
    kind: "run",
    status: "ok",
    startedAt: new Date(Date.now() - 60_000),
    triggerNodeId: "hook",
    triggerPayload: serializeTriggerPayload({ body: { week: 41 } }),
  });
  const outcome = await RunProcedure(scheduled._id, { triggerNodeId: "hook" });
  assert.equal(outcome.status, "ok");
  const run = runs.find((r) => r._id === outcome.runId);
  assert.ok(run);
  assert.equal(run.triggerNodeId, "hook");
  assert.ok(isString(run.triggerPayload));
  assert.deepEqual(JSON.parse(run.triggerPayload), { body: { week: 41 } });
});

void test("it is refused as Run now is", async () => {
  await assert.rejects(RunProcedure("reports.missing"), (err) => {
    assert.equal(thrown(err).status, 404);
    return true;
  });
  await assert.rejects(RunProcedure(broken._id), (err) => {
    const { status } = thrown(err);
    assert.ok(isNumber(status) && status >= 400 && status < 500);
    return true;
  });
  await assert.rejects(
    RunProcedure(scheduled._id, { triggerNodeId: "nope" }),
    (err) => {
      assert.equal(thrown(err).status, 404);
      return true;
    },
  );
});
