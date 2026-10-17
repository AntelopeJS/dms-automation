const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");
const { Schema } = require("@antelopejs/interface-database");

// DeclareProcedure against in-memory tables: a procedure shipped as code is
// created once under its declared id, refreshed only while it is still what
// was declared last, kept once someone changed it, and validated as an
// import (and as enabling it in the builder when it is enabled).

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
const {
  ProcedureRunModel,
} = require("../dist/db/models/procedure_run.model.js");
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
const renamed = [];
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
  update: async (id, patch) => {
    procedures.set(id, { ...procedures.get(id), ...patch });
    return 1;
  },
  updateAtRevision: async (id, revision, patch) => {
    const row = procedures.get(id);
    if (!row || row.revision !== revision) return false;
    procedures.set(id, { ...row, ...patch });
    return true;
  },
});
Object.assign(ProcedureRunModel.prototype, {
  renameProcedure: async (id, name) => renamed.push([id, name]),
  markOlderVersions: async () => {},
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
  renamed.length = 0;
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
  assert.ok(stored.declaredHash);
  assert.deepEqual(JSON.parse(stored.graph).nodes[1].config, {
    message: "hello",
  });
  // The reconcile hook arms it now, not at the next restart.
  assert.deepEqual(changed, ["shop.welcome"]);
});

test("declaring the same thing again preserves the stored procedure", async () => {
  await declareProcedure(declaration());
  const before = structuredClone(procedures.get("shop.welcome"));
  changed.length = 0;

  const result = await declareProcedure(declaration());
  assert.equal(result.status, "unchanged");
  assert.deepEqual(procedures.get("shop.welcome"), before);
  assert.equal(procedures.size, 1);
});

for (const failedStep of ["rename", "version"]) {
  test(`a retry repairs run history after a failed ${failedStep} without a new revision`, async (t) => {
    await declareProcedure(declaration());
    const run = { name: "Welcome", version: 1, currentVersion: 1 };
    let failing = true;
    t.mock.method(
      ProcedureRunModel.prototype,
      "renameProcedure",
      async (_id, name) => {
        if (failing && failedStep === "rename")
          throw new Error("history unavailable");
        run.name = name;
      },
    );
    t.mock.method(
      ProcedureRunModel.prototype,
      "markOlderVersions",
      async (_id, version) => {
        if (failing && failedStep === "version")
          throw new Error("history unavailable");
        if (run.version < version) run.currentVersion = version;
      },
    );
    const next = declaration({ name: "Updated", graph: graphOf("new") });
    await assert.rejects(declareProcedure(next), /history unavailable/);
    const committed = structuredClone(procedures.get(next.id));
    failing = false;
    const retry = await declareProcedure(next);
    assert.equal(retry.status, "unchanged");
    assert.deepEqual(run, { name: "Updated", version: 1, currentVersion: 2 });
    assert.deepEqual(procedures.get(next.id), committed);
  });
}

test("a changed declaration replaces a procedure nobody touched", async () => {
  await declareProcedure(declaration());
  changed.length = 0;

  const result = await declareProcedure(
    declaration({ name: "Welcome aboard", graph: graphOf("bonjour") }),
  );
  assert.equal(result.status, "updated");
  const stored = procedures.get("shop.welcome");
  assert.equal(stored.name, "Welcome aboard");
  assert.equal(JSON.parse(stored.graph).nodes[1].config.message, "bonjour");
  assert.equal(stored.version, 2, "the graph changed what a run does");
  assert.equal(stored.revision, 2, "an open builder cannot save over it");
  assert.deepEqual(renamed, [["shop.welcome", "Welcome aboard"]]);
  assert.deepEqual(changed, ["shop.welcome"]);
});

test("a procedure someone edited is kept as they made it", async () => {
  await declareProcedure(declaration());
  // An edit from the builder: new graph, new revision, same declaredHash.
  const row = procedures.get("shop.welcome");
  procedures.set("shop.welcome", {
    ...row,
    graph: JSON.stringify(graphOf("edited by hand")),
    revision: 2,
  });
  changed.length = 0;

  const result = await declareProcedure(
    declaration({ graph: graphOf("new upstream text") }),
  );
  assert.equal(result.status, "kept");
  const graph = JSON.parse(procedures.get("shop.welcome").graph);
  assert.equal(graph.nodes[1].config.message, "edited by hand");
  assert.deepEqual(changed, []);
});

test("a paused procedure stays paused", async () => {
  await declareProcedure(declaration());
  const row = procedures.get("shop.welcome");
  procedures.set("shop.welcome", { ...row, enabled: false, revision: 2 });

  const result = await declareProcedure(declaration());
  assert.equal(result.status, "kept");
  assert.equal(result.enabled, false);
  assert.equal(procedures.get("shop.welcome").enabled, false);
});

test("a procedure back to exactly what was declared is refreshed again", async () => {
  await declareProcedure(declaration());
  const row = procedures.get("shop.welcome");
  // Paused, then resumed: the content is the declared one again.
  procedures.set("shop.welcome", { ...row, revision: 3 });

  const result = await declareProcedure(declaration({ graph: graphOf("v2") }));
  assert.equal(result.status, "updated");
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

test("two instances declaring at once store one procedure", async () => {
  const results = await Promise.all([
    declareProcedure(declaration()),
    declareProcedure(declaration()),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [
    "created",
    "unchanged",
  ]);
  assert.equal(procedures.size, 1);
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
