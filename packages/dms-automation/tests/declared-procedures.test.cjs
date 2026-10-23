const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");
const { Schema } = require("@antelopejs/interface-database");

// DeclareProcedure against in-memory tables: a procedure shipped as code is
// created once under its declared id, never touched afterwards, and
// validated as an import (and as enabling it in the builder when it is
// enabled).

// GetModel builds its models on a registered schema: hand it a bare one, the
// data access is replaced below.
Schema.get = () => ({ instance: () => ({ table: () => ({}) }) });

const {
  builtinActions,
  builtinDataNodes,
  builtinTriggers,
} = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { ProcedureModel } = require("../dist/db/models/procedure.model.js");
const { subscriptions } = require("../dist/runtime/subscriptions.js");
const { declareProcedure } = require("../dist/runtime/declaredProcedures.js");
const {
  DeclareProcedure,
} = require("../dist/implementations/dms-automation/index.js");
const {
  markModuleStarted,
  markModuleStopped,
} = require("../dist/runtime/readiness.js");

for (const t of builtinTriggers) registry.addTrigger(t.id, t);
for (const a of builtinActions) registry.addAction(a.id, a);
for (const d of builtinDataNodes) registry.addDataNode(d.id, d);

const procedures = new Map();
const changed = [];

Object.assign(ProcedureModel.prototype, {
  get: async (id) =>
    procedures.has(id) ? structuredClone(procedures.get(id)) : undefined,
  getAll: async () => [...procedures.values()].map((p) => structuredClone(p)),
  listEnabled: async () =>
    [...procedures.values()]
      .filter((p) => p.enabled)
      .map((p) => structuredClone(p)),
  insert: async (doc) => {
    if (procedures.has(doc._id)) throw new Error("E11000 duplicate key");
    procedures.set(doc._id, structuredClone(doc));
    return [doc._id];
  },
});
subscriptions.onProcedureChange = async (id) => {
  changed.push(id);
};

const node = (id, kind, typeId, config = {}) => ({
  id,
  kind,
  typeId,
  config,
  position: { x: 0, y: 0 },
});

const graphOf = (message = "hello") => ({
  nodes: [
    node("start", "trigger", "manual"),
    node("say", "action", "log.message", { message }),
  ],
  triggerEdges: [{ id: "e1", from: { node: "start" }, to: { node: "say" } }],
  dataEdges: [],
});

const declaration = (extra = {}) => ({
  id: "shop.welcome",
  name: "Welcome",
  description: "Greets",
  graph: graphOf(),
  enabled: true,
  ...extra,
});

beforeEach(() => {
  procedures.clear();
  changed.length = 0;
});

test("a first declaration stores the procedure under its id, enabled and armed", async () => {
  const result = await declareProcedure(declaration());
  assert.equal(result.id, "shop.welcome");
  assert.equal(result.status, "created");
  assert.equal(result.enabled, true);

  const stored = procedures.get("shop.welcome");
  assert.equal(stored.name, "Welcome");
  assert.equal(stored.enabled, true);
  assert.equal(stored.version, 1);
  assert.equal(stored.revision, 1);
  assert.equal("declaredHash" in stored, false);
  assert.deepEqual(JSON.parse(stored.graph).nodes[1].config, {
    message: "hello",
  });
  // The reconcile hook arms it now, not at the next restart.
  assert.deepEqual(changed, ["shop.welcome"]);
});

test("a later declaration leaves the stored procedure as it is", async () => {
  await declareProcedure(declaration());
  // An edit from the builder, then a declaration that changed upstream.
  const row = procedures.get("shop.welcome");
  procedures.set("shop.welcome", {
    ...row,
    graph: JSON.stringify(graphOf("edited by hand")),
    enabled: false,
    revision: 2,
  });
  const before = structuredClone(procedures.get("shop.welcome"));
  changed.length = 0;

  const result = await declareProcedure(
    declaration({
      name: "Welcome aboard",
      graph: graphOf("new upstream text"),
    }),
  );
  assert.equal(result.status, "kept");
  assert.equal(result.enabled, false, "the stored state, not the declared one");
  assert.deepEqual(procedures.get("shop.welcome"), before);
  assert.deepEqual(changed, []);
});

test("a deleted procedure is created again by the next declaration", async () => {
  await declareProcedure(declaration());
  procedures.delete("shop.welcome");

  const result = await declareProcedure(declaration());
  assert.equal(result.status, "created");
  assert.equal(procedures.size, 1);
});

test("a disabled declaration is stored as a draft, its problems listed", async () => {
  const graph = graphOf();
  graph.nodes = [node("say", "action", "log.message")];
  graph.triggerEdges = [];
  const result = await declareProcedure(declaration({ graph, enabled: false }));
  assert.equal(result.status, "created");
  assert.equal(result.enabled, false);
  assert.ok(result.issues.some((i) => i.code === "untriggered"));
});

test("an enabled declaration with a blocking problem is refused, nothing stored", async () => {
  const graph = graphOf();
  graph.nodes = [node("say", "action", "log.message")];
  graph.triggerEdges = [];
  await assert.rejects(
    declareProcedure(declaration({ graph })),
    /DeclareProcedure\("shop\.welcome"\) refused: .*trigger/,
  );
  assert.equal(procedures.size, 0);
});

test("an enabled declaration on a webhook route another procedure answers is refused", async () => {
  const webhookGraph = (path) => ({
    nodes: [node("hook", "trigger", "webhook", { path, method: "POST" })],
    triggerEdges: [],
    dataEdges: [],
  });
  procedures.set("other", {
    _id: "other",
    name: "Other",
    enabled: true,
    graph: JSON.stringify(webhookGraph("/webhooks/quotes")),
    revision: 1,
    version: 1,
  });
  await assert.rejects(
    declareProcedure(declaration({ graph: webhookGraph("/webhooks/quotes") })),
    /already answers for the procedure "Other"/,
  );
  assert.equal(procedures.has("shop.welcome"), false);
});

test("a trigger type not registered yet does not block: it arms when it registers", async () => {
  const graph = graphOf();
  graph.nodes[0] = node("start", "trigger", "support.ticket-opened");
  const result = await declareProcedure(declaration({ graph }));
  assert.equal(result.status, "created");
  assert.equal(result.enabled, true);
  const late = result.issues.find((i) => i.code === "unknownType");
  assert.equal(late?.severity, "warning");
});

test("a malformed declaration is refused with what is wrong", async () => {
  await assert.rejects(
    declareProcedure({ ...declaration(), id: "has spaces" }),
    /refused: id: letters, digits/,
  );
  await assert.rejects(
    declareProcedure({ ...declaration(), enabled: undefined }),
    /refused: enabled: Required/,
  );
  await assert.rejects(
    declareProcedure({ ...declaration(), graph: { nodes: "no" } }),
    /refused: graph\.nodes/,
  );
  assert.equal(procedures.size, 0);
});

test("the interface call waits until the module has started", async () => {
  markModuleStopped();
  markModuleStarted();
  markModuleStopped();
  let settled = false;
  const call = DeclareProcedure(declaration()).then((r) => {
    settled = true;
    return r;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, false, "no database access before start()");
  assert.equal(procedures.size, 0);
  markModuleStarted();
  assert.equal((await call).status, "created");
});
