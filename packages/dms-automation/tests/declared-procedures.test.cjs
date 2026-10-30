const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");
const { DuplicateKeyError, Schema } = require("@antelopejs/interface-database");

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

const { parseGraph } = require("../dist/types/graph.js");

/** @typedef {import("@antelopejs/interface-dms-automation").ProcedureDeclaration} ProcedureDeclaration */
/** @typedef {import("@antelopejs/interface-dms-automation").ProcedureGraph} ProcedureGraph */
/** @typedef {{ _id: string, name: string, enabled: boolean, graph: string, version: number, revision: number, description?: string }} StoredProcedure */

for (const t of builtinTriggers) registry.addTrigger(t.id, t);
for (const a of builtinActions) registry.addAction(a.id, a);
for (const d of builtinDataNodes) registry.addDataNode(d.id, d);

/** @type {Map<string, StoredProcedure>} */
const procedures = new Map();
/** @type {Array<string | undefined>} */
const changed = [];

/** @param {string} id */
const readProcedure = async (id) =>
  procedures.has(id) ? structuredClone(procedures.get(id)) : undefined;
/**
 * @param {StoredProcedure} doc
 * @returns {Promise<string[]>}
 */
const insertProcedure = async (doc) => {
  if (procedures.has(doc._id)) throw new DuplicateKeyError("_id", ["_id"]);
  procedures.set(doc._id, structuredClone(doc));
  return [doc._id];
};

Object.assign(ProcedureModel.prototype, {
  get: readProcedure,
  getAll: async () => [...procedures.values()].map((p) => structuredClone(p)),
  listEnabled: async () =>
    [...procedures.values()]
      .filter((p) => p.enabled)
      .map((p) => structuredClone(p)),
  insert: insertProcedure,
});
subscriptions.onProcedureChange = async (id) => {
  changed.push(id);
};

/**
 * @param {string} id
 * @param {string} kind
 * @param {string} typeId
 * @param {Record<string, unknown>} [config]
 */
const node = (id, kind, typeId, config = {}) => ({
  id,
  kind,
  typeId,
  config,
  position: { x: 0, y: 0 },
});

/**
 * @param {string} [message]
 * @returns {ProcedureGraph}
 */
const graphOf = (message = "hello") => ({
  nodes: [
    node("start", "trigger", "manual"),
    node("say", "action", "log.message", { message }),
  ],
  triggerEdges: [{ id: "e1", from: { node: "start" }, to: { node: "say" } }],
  dataEdges: [],
});

/**
 * @param {Partial<ProcedureDeclaration>} [extra]
 * @returns {ProcedureDeclaration}
 */
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

void test("a first declaration stores the procedure under its id, enabled and armed", async () => {
  const result = await declareProcedure(declaration());
  assert.equal(result.id, "shop.welcome");
  assert.equal(result.status, "created");
  assert.equal(result.enabled, true);

  const stored = procedures.get("shop.welcome");
  assert.ok(stored);
  assert.equal(stored.name, "Welcome");
  assert.equal(stored.enabled, true);
  assert.equal(stored.version, 1);
  assert.equal(stored.revision, 1);
  assert.equal("declaredHash" in stored, false);
  assert.deepEqual(parseGraph(stored.graph).nodes[1].config, {
    message: "hello",
  });
  assert.deepEqual(changed, ["shop.welcome"]);
});

void test("a later declaration leaves the stored procedure as it is", async () => {
  await declareProcedure(declaration());
  const row = procedures.get("shop.welcome");
  assert.ok(row);
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

void test("two declarations at the same moment: one creates, the other keeps", async () => {
  /** @type {(value?: unknown) => void} */
  let release;
  const bothRead = new Promise((resolve) => (release = resolve));
  let reads = 0;
  /** @param {string} id */
  ProcedureModel.prototype.get = async (id) => {
    const found = await readProcedure(id);
    if (++reads === 2) release();
    await bothRead;
    return found;
  };
  try {
    const results = await Promise.all([
      declareProcedure(declaration()),
      declareProcedure(declaration()),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["created", "kept"]);
    assert.ok(results.every((r) => r.enabled === true));
    assert.equal(procedures.size, 1);
  } finally {
    ProcedureModel.prototype.get = readProcedure;
  }
});

void test("an insert failing for another reason still rejects", async () => {
  ProcedureModel.prototype.insert = async () => {
    throw new Error("connection lost");
  };
  try {
    await assert.rejects(declareProcedure(declaration()), /connection lost/);
  } finally {
    ProcedureModel.prototype.insert = insertProcedure;
  }
});

void test("a deleted procedure is created again by the next declaration", async () => {
  await declareProcedure(declaration());
  procedures.delete("shop.welcome");

  const result = await declareProcedure(declaration());
  assert.equal(result.status, "created");
  assert.equal(procedures.size, 1);
});

void test("a disabled declaration is stored as a draft, its problems listed", async () => {
  const graph = graphOf();
  graph.nodes = [node("say", "action", "log.message")];
  graph.triggerEdges = [];
  const result = await declareProcedure(declaration({ graph, enabled: false }));
  assert.equal(result.status, "created");
  assert.equal(result.enabled, false);
  assert.ok(result.issues.some((i) => i.code === "untriggered"));
});

void test("an enabled declaration with a blocking problem is refused, nothing stored", async () => {
  const graph = graphOf();
  graph.nodes = [node("say", "action", "log.message")];
  graph.triggerEdges = [];
  await assert.rejects(
    declareProcedure(declaration({ graph })),
    /DeclareProcedure\("shop\.welcome"\) refused: .*trigger/,
  );
  assert.equal(procedures.size, 0);
});

void test("an enabled declaration on a webhook route another procedure answers is refused", async () => {
  /**
   * @param {string} path
   * @returns {ProcedureGraph}
   */
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

void test("a trigger type not registered yet does not block: it arms when it registers", async () => {
  const graph = graphOf();
  graph.nodes[0] = node("start", "trigger", "support.ticket-opened");
  const result = await declareProcedure(declaration({ graph }));
  assert.equal(result.status, "created");
  assert.equal(result.enabled, true);
  const late = result.issues.find((i) => i.code === "unknownType");
  assert.equal(late?.severity, "warning");
});

void test("a malformed declaration is refused with what is wrong", async () => {
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

void test("the interface call waits until the module has started", async () => {
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
