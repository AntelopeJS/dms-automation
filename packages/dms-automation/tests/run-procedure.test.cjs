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
const { ProceduresController } = require("../dist/routes/procedures.js");
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
/**
 * A manual trigger and a webhook start it.
 * @type {StoredProcedure}
 */
const intake = {
  ...scheduled,
  _id: "orders.intake",
  graph: JSON.stringify({
    nodes: [
      node("hook", "trigger", "webhook", { path: "/intake" }),
      node("start", "trigger", "manual"),
      node("log", "action", "log.message", { message: "intake" }),
    ],
    triggerEdges: [edge("hook", "log"), edge("start", "log")],
    dataEdges: [],
  }),
};
/** @type {StoredProcedure} */
const unconfigured = {
  ...scheduled,
  _id: "reports.unconfigured",
  enabled: false,
  graph: JSON.stringify({
    nodes: [
      node("start", "trigger", "manual"),
      node("call", "action", "http.request"),
    ],
    triggerEdges: [edge("start", "call")],
    dataEdges: [],
  }),
};
/** @type {StoredProcedure} */
const untriggered = {
  ...scheduled,
  _id: "reports.untriggered",
  enabled: false,
  graph: JSON.stringify({
    nodes: [node("log", "action", "log.message", { message: "report" })],
    triggerEdges: [],
    dataEdges: [],
  }),
};
/** @type {StoredProcedure} */
const bare = {
  ...scheduled,
  _id: "reports.bare",
  enabled: false,
  graph: JSON.stringify({
    nodes: [node("call", "action", "http.request")],
    triggerEdges: [],
    dataEdges: [],
  }),
};
/** @type {Map<string, StoredProcedure>} */
const procedures = new Map([
  [scheduled._id, scheduled],
  [broken._id, broken],
  [intake._id, intake],
  [unconfigured._id, unconfigured],
  [untriggered._id, untriggered],
  [bare._id, bare],
]);

/** @type {RunRow[]} */
const runs = [];
/** @param {string} id */
ProcedureModel.prototype.get = async (id) => procedures.get(id);
/** @param {Partial<ProcedureRun>} row */
ProcedureRunModel.prototype.insert = async (row) => {
  const _id = `run-${runs.length + 1}`;
  runs.push({ ...row, _id, startedAt: row.startedAt });
  return [_id];
};
/** @param {string} id */
ProcedureRunModel.prototype.get = async (id) => runs.find((r) => r._id === id);
/**
 * @param {string} procedureId
 * @param {HistoryQuery} query
 */
ProcedureRunModel.prototype.newest = async (procedureId, { before }) =>
  runs
    .filter(
      (r) =>
        r.procedureId === procedureId &&
        r.kind !== "test" &&
        r.startedAt < before,
    )
    .sort((a, b) => b.startedAt - a.startedAt)[0];

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

void test("without a trigger named, the last payload is the default trigger's", async () => {
  runs.push(
    {
      _id: "manual-earlier",
      procedureId: intake._id,
      kind: "run",
      status: "ok",
      startedAt: new Date(Date.now() - 120_000),
      triggerNodeId: "start",
      triggerPayload: serializeTriggerPayload({ from: "manual" }),
    },
    {
      _id: "hook-later",
      procedureId: intake._id,
      kind: "run",
      status: "ok",
      startedAt: new Date(Date.now() - 60_000),
      triggerNodeId: "hook",
      triggerPayload: serializeTriggerPayload({ from: "webhook" }),
    },
  );
  const { last } = await new ProceduresController().lastPayload(
    undefined,
    intake._id,
  );
  assert.equal(last?.triggerNodeId, "start");
  assert.deepEqual(last?.payload, { from: "manual" });
});

void test("without a trigger named, it runs from the default trigger with its last payload", async () => {
  const outcome = await RunProcedure(intake._id);
  const run = runs.find((r) => r._id === outcome.runId);
  assert.ok(run);
  assert.equal(run.triggerNodeId, "start");
  assert.ok(isString(run.triggerPayload));
  assert.deepEqual(JSON.parse(run.triggerPayload), { from: "manual" });
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

/**
 * The toast of a refusal and the codes of the blocking issues it lists.
 * @param {unknown} body
 * @returns {{ message: unknown, codes: unknown[] }}
 */
function refusal(body) {
  assert.ok(isString(body));
  /** @type {unknown} */
  const parsed = JSON.parse(body);
  assert.ok(isPropertyBag(parsed) && Array.isArray(parsed.issues));
  const codes = parsed.issues
    .filter((i) => isPropertyBag(i) && i.severity === "error")
    .map((i) => isPropertyBag(i) && i.code);
  return { message: parsed.message, codes };
}

void test("a graph with a step missing its settings or no trigger is refused with its issues", async () => {
  const stored = runs.length;
  /** @type {[StoredProcedure, string, string][]} */
  const cases = [
    [unconfigured, "missingField", "graphHasErrors"],
    [untriggered, "noTrigger", "noTriggerToRun"],
    [bare, "missingField", "noTriggerToRun"],
    [bare, "noTrigger", "noTriggerToRun"],
  ];
  for (const [procedure, code, toast] of cases) {
    await assert.rejects(RunProcedure(procedure._id), (err) => {
      const { status, body } = thrown(err);
      assert.equal(status, 400);
      const { message, codes } = refusal(body);
      assert.equal(message, `$dms_automation.api.${toast}`);
      assert.ok(codes.includes(code), `${procedure._id} lists ${code}`);
      return true;
    });
  }
  for (const procedure of [untriggered, unconfigured]) {
    await assert.rejects(
      RunProcedure(procedure._id, { triggerNodeId: "nope" }),
      (err) => {
        assert.equal(thrown(err).status, 404, `${procedure._id} has no "nope"`);
        return true;
      },
    );
  }
  assert.equal(runs.length, stored, "no run is stored");
});
