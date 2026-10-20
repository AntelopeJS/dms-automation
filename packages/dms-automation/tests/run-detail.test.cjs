const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Schema } = require("@antelopejs/interface-database");

// GET /api/automation/runs/:id against in-memory tables: the run comes with
// what started it, worded by the server, for the trace and the run drawer.

// GetModel builds its models on a registered schema: hand it a bare one, the
// data access is replaced below.
Schema.get = () => ({ instance: () => ({ table: () => ({}) }) });

const { ProcedureModel } = require("../dist/db/models/procedure.model.js");
const {
  ProcedureRunModel,
} = require("../dist/db/models/procedure_run.model.js");
const { RunsController } = require("../dist/routes/runs.js");

const runs = new Map();
Object.assign(ProcedureRunModel.prototype, {
  get: async (id) => runs.get(id),
  newest: async () => undefined,
  oldest: async () => undefined,
  countHistory: async () => 0,
  successTimings: async () => [],
});
Object.assign(ProcedureModel.prototype, { get: async () => undefined });

function storedRun(id, triggerSummary) {
  runs.set(id, {
    _id: id,
    procedureId: "p1",
    procedureName: "Nightly sync",
    startedAt: new Date("2026-01-01T02:00:00Z"),
    status: "ok",
    kind: "run",
    triggerNodeId: "t1",
    triggerPayload: "{}",
    triggerSummary,
  });
}

const getOne = (id) => new RunsController().getOne({}, id);

test("a run's detail words its trigger: a schedule in the zone it fired in", async () => {
  storedRun("r1", {
    nodeId: "t1",
    typeId: "cron",
    typeName: "$dms_automation.types.cron.name",
    cron: "0 2 * * *",
    timeZone: "Europe/Brussels",
  });
  const run = await getOne("r1");
  assert.equal(run.trigger.cron, "0 2 * * *");
  assert.deepEqual(run.triggerText, {
    key: "dms_automation.cron.daily",
    params: { time: "02:00 (Europe/Brussels)" },
  });
});

test("a run's detail words a webhook, a named trigger, and no trigger", async () => {
  storedRun("r2", {
    nodeId: "t1",
    typeId: "webhook",
    typeName: "Webhook",
    method: "PUT",
    path: "/hooks/in",
  });
  assert.equal((await getOne("r2")).triggerText, "PUT /hooks/in");
  storedRun("r3", { nodeId: "t1", typeId: "manual", typeName: "Manual" });
  assert.equal((await getOne("r3")).triggerText, "Manual");
  storedRun("r4", undefined);
  const untriggered = await getOne("r4");
  assert.equal(untriggered.trigger, null);
  assert.equal(untriggered.triggerText, "$dms_automation.trigger.none");
});
