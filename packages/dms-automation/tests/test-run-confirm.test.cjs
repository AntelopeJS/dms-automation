const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Schema } = require("@antelopejs/interface-database");

Schema.get = () => ({ instance: () => ({ table: () => ({}) }) });

const { ProcedureModel } = require("../dist/db/models/procedure.model.js");
const {
  ProcedureRunModel,
} = require("../dist/db/models/procedure_run.model.js");
const { builtinActions, builtinTriggers } = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { ProceduresController } = require("../dist/routes/procedures.js");
const { isString } = require("../dist/types/guards.js");

for (const t of builtinTriggers) registry.addTrigger(t.id, t);
for (const a of builtinActions) registry.addAction(a.id, a);

let sent = 0;
registry.addAction("acme.send", {
  id: "acme.send",
  name: "Send",
  description: "",
  icon: "i-ph-envelope",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  async execute() {
    sent += 1;
    return {};
  },
});

const node = (id, kind, typeId) => ({
  id,
  kind,
  typeId,
  config: {},
  position: { x: 0, y: 0 },
});
const draft = {
  nodes: [node("t", "trigger", "manual"), node("send", "action", "acme.send")],
  triggerEdges: [{ id: "t-send", from: { node: "t" }, to: { node: "send" } }],
  dataEdges: [],
};

const procedure = {
  _id: "p1",
  name: "Welcome",
  enabled: false,
  graph: JSON.stringify({ nodes: [], triggerEdges: [], dataEdges: [] }),
  revision: 1,
  version: 1,
};
const runs = [];
Object.assign(ProcedureModel.prototype, {
  get: async (id) => (id === procedure._id ? procedure : undefined),
});
Object.assign(ProcedureRunModel.prototype, {
  insert: async (row) => {
    const _id = `run-${runs.length + 1}`;
    runs.push({ ...row, _id });
    return [_id];
  },
  get: async (id) => runs.find((r) => r._id === id),
});

const controller = Object.create(ProceduresController.prototype);

void test("the steps a test acts for real through are listed", async () => {
  const { realEffects } = await controller.testEffects(undefined, "p1", {
    graph: draft,
  });
  assert.deepEqual(realEffects, [
    { nodeId: "send", typeId: "acme.send", typeName: "Send" },
  ]);
});

void test("a test with real effects is refused until they are confirmed", async () => {
  await assert.rejects(
    controller.test(undefined, "p1", { graph: draft, payload: {} }),
    (err) => {
      assert.equal(err.status, 409);
      const body = isString(err.body) ? JSON.parse(err.body) : err.body;
      assert.equal(body.realEffects[0].nodeId, "send");
      return true;
    },
  );
  assert.equal(sent, 0);
  assert.equal(runs.length, 0);

  const outcome = await controller.test(undefined, "p1", {
    graph: draft,
    payload: {},
    confirmRealEffects: true,
  });
  assert.equal(outcome.status, "ok");
  assert.equal(sent, 1);
  assert.equal(runs[0].kind, "test");
});

void test("a test without real effects needs no confirmation", async () => {
  const pure = {
    ...draft,
    nodes: [
      node("t", "trigger", "manual"),
      node("log", "action", "log.message"),
    ],
    triggerEdges: [{ id: "t-log", from: { node: "t" }, to: { node: "log" } }],
  };
  const outcome = await controller.test(undefined, "p1", {
    graph: pure,
    payload: {},
  });
  assert.equal(outcome.status, "ok");
});
