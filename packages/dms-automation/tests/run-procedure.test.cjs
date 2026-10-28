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

for (const t of builtinTriggers) registry.addTrigger(t.id, t);
for (const a of builtinActions) registry.addAction(a.id, a);
for (const d of builtinDataNodes) registry.addDataNode(d.id, d);
markModuleStarted();

const node = (id, kind, typeId, config = {}) => ({
  id,
  kind,
  typeId,
  config,
  position: { x: 0, y: 0 },
});
const edge = (from, to) => ({
  id: `${from}-${to}`,
  from: { node: from },
  to: { node: to },
});

/** A schedule and a webhook start it; nothing else does. */
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
const broken = {
  ...scheduled,
  _id: "reports.broken",
  graph: JSON.stringify({ nodes: [], triggerEdges: [], dataEdges: [] }),
};
const procedures = new Map([
  [scheduled._id, scheduled],
  [broken._id, broken],
]);

const runs = [];
Object.assign(ProcedureModel.prototype, {
  get: async (id) => procedures.get(id),
});
Object.assign(ProcedureRunModel.prototype, {
  insert: async (row) => {
    const _id = `run-${runs.length + 1}`;
    runs.push({ ...row, _id, startedAt: row.startedAt });
    return [_id];
  },
  get: async (id) => runs.find((r) => r._id === id),
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

test("a procedure without a manual trigger runs from code", async () => {
  await assert.rejects(InvokeProcedure(scheduled._id), (err) => {
    assert.match(err.body, /no manual trigger/);
    return true;
  });

  const outcome = await RunProcedure(scheduled._id, {
    payload: { firedAt: "2026-10-12T09:00:00.000Z" },
  });
  assert.deepEqual(outcome, { runId: "run-1", status: "ok" });
  const [run] = runs;
  assert.equal(run.triggerNodeId, "monday");
  assert.equal(run.kind, "run");
  assert.deepEqual(JSON.parse(run.triggerPayload), {
    firedAt: "2026-10-12T09:00:00.000Z",
  });
});

test("it starts from the trigger named, with its last payload by default", async () => {
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
  assert.equal(run.triggerNodeId, "hook");
  assert.deepEqual(JSON.parse(run.triggerPayload), { body: { week: 41 } });
});

test("it is refused as Run now is", async () => {
  await assert.rejects(RunProcedure("reports.missing"), (err) => {
    assert.equal(err.status, 404);
    return true;
  });
  await assert.rejects(RunProcedure(broken._id), (err) => {
    assert.ok(err.status >= 400 && err.status < 500);
    return true;
  });
  await assert.rejects(
    RunProcedure(scheduled._id, { triggerNodeId: "nope" }),
    (err) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
});
