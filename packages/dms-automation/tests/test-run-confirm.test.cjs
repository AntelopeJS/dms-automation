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
const { isPropertyBag, isString } = require("../dist/types/guards.js");

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

/**
 * @param {string} id
 * @param {string} kind
 * @param {string} typeId
 * @returns {import("../dist/types/graph.js").GraphNode}
 */
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
/** @type {Partial<import("../dist/db/tables/procedure_run.table.js").ProcedureRun>[]} */
const runs = [];
Object.assign(ProcedureModel.prototype, {
  get: async (/** @type {string} */ id) =>
    id === procedure._id ? procedure : undefined,
});
Object.assign(ProcedureRunModel.prototype, {
  insert: async (
    /** @type {Partial<import("../dist/db/tables/procedure_run.table.js").ProcedureRun>} */ row,
  ) => {
    const _id = `run-${runs.length + 1}`;
    runs.push({ ...row, _id });
    return [_id];
  },
  get: async (/** @type {string} */ id) => runs.find((r) => r._id === id),
});

const controller = new ProceduresController();

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
      assert.ok(isPropertyBag(err));
      assert.equal(err.status, 409);
      /** @type {unknown} */
      const body = isString(err.body) ? JSON.parse(err.body) : err.body;
      assert.ok(
        isPropertyBag(body) &&
          Array.isArray(body.realEffects) &&
          isPropertyBag(body.realEffects[0]),
      );
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
