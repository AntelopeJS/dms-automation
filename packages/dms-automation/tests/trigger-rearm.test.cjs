const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Schema } = require("@antelopejs/interface-database");

// Trigger types registered after the boot reconcile: modules start in
// parallel, so a project's trigger type can arrive after the module armed
// its procedures. Registering it must arm the procedures waiting for it,
// unregistering must tear down every handle it armed, and registering it
// again (a hot reload) must arm them again.

// GetModel builds its models on a registered schema: hand it a bare one, the
// data access is replaced below.
Schema.get = () => ({ instance: () => ({ table: () => ({}) }) });

const { ProcedureModel } = require("../dist/db/models/procedure.model.js");
const {
  ProcedureRunModel,
} = require("../dist/db/models/procedure_run.model.js");
const {
  AutomationTemplateModel,
} = require("../dist/db/models/automation_template.model.js");
const { TypeSwitchModel } = require("../dist/db/models/type_switch.model.js");
const { subscriptions } = require("../dist/runtime/subscriptions.js");
const { internal } = require("../dist/implementations/dms-automation/index.js");

const TYPE_ID = "support.ticket-opened";

const graphOn = (typeId) =>
  JSON.stringify({
    nodes: [
      {
        id: "start",
        kind: "trigger",
        typeId,
        config: {},
        position: { x: 0, y: 0 },
      },
    ],
    triggerEdges: [],
    dataEdges: [],
  });

const procedures = new Map([
  [
    "P1",
    {
      _id: "P1",
      name: "One",
      enabled: true,
      graph: graphOn(TYPE_ID),
      revision: 1,
      version: 1,
    },
  ],
  [
    "P2",
    {
      _id: "P2",
      name: "Two",
      enabled: true,
      graph: graphOn(TYPE_ID),
      revision: 1,
      version: 1,
    },
  ],
]);

Object.assign(ProcedureModel.prototype, {
  listEnabled: async () =>
    [...procedures.values()].filter((p) => p.enabled).map((p) => ({ ...p })),
  update: async (id, patch) => {
    procedures.set(id, { ...procedures.get(id), ...patch });
    return 1;
  },
});
Object.assign(AutomationTemplateModel.prototype, { listAll: async () => [] });
Object.assign(TypeSwitchModel.prototype, { getAll: async () => [] });

/** A trigger type that records what it arms and tears down. */
function recordingType() {
  const type = {
    id: TYPE_ID,
    name: "Ticket opened",
    description: "Fires when a service ticket is opened",
    icon: "i-lucide-ticket",
    configSchema: { type: "object" },
    outputSchema: { type: "object" },
    cluster: "replicated",
    armed: new Set(),
    async activate() {
      const handle = Symbol("handle");
      type.armed.add(handle);
      return handle;
    },
    async deactivate(handle) {
      type.armed.delete(handle);
    },
  };
  return type;
}

async function until(condition, what) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const armErrorOf = (id) => procedures.get(id).armErrors ?? "";

test("a late trigger type arms its procedures, and a reload re-arms them", async () => {
  await subscriptions.hydrate();
  assert.match(subscriptions.activationErrorOf("P1"), /is not available/);
  assert.match(armErrorOf("P2"), /unknownType/);

  const first = recordingType();
  internal.RegisterTriggerType.register(TYPE_ID, first);
  await until(() => first.armed.size === 2, "both procedures to arm");
  await until(
    () => armErrorOf("P1") === "" && armErrorOf("P2") === "",
    "arm errors to clear",
  );
  assert.equal(subscriptions.activationErrorOf("P1"), undefined);

  // Hot reload: the old definition goes, a new one comes.
  internal.RegisterTriggerType.unregister(TYPE_ID);
  const second = recordingType();
  internal.RegisterTriggerType.register(TYPE_ID, second);
  await until(() => first.armed.size === 0, "every old handle to be torn down");
  await until(() => second.armed.size === 2, "the new definition to arm both");

  // Gone for good: torn down, and the procedures say why they do not start.
  internal.RegisterTriggerType.unregister(TYPE_ID);
  await until(() => second.armed.size === 0, "teardown");
  await until(() => /unknownType/.test(armErrorOf("P1")), "the arm error");

  await subscriptions._deactivateAll();
});

test("a reload during activation releases each definition's own handles", async (t) => {
  t.after(async () => {
    await subscriptions._deactivateAll();
    internal.RegisterTriggerType.unregister(TYPE_ID);
  });
  const first = recordingType();
  const second = recordingType();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const activate = first.activate.bind(first);
  first.activate = async () => {
    entered.resolve();
    await release.promise;
    return activate();
  };
  internal.RegisterTriggerType.register(TYPE_ID, first);
  const boot = subscriptions.hydrate();
  await entered.promise;
  internal.RegisterTriggerType.unregister(TYPE_ID);
  internal.RegisterTriggerType.register(TYPE_ID, second);
  release.resolve();
  await boot;
  // Wait behind the queued reload before observing the resulting subscriptions.
  await subscriptions.onProcedureChange();
  assert.equal(first.armed.size, 0);
  assert.equal(second.armed.size, 2);
  await subscriptions._deactivateAll();
  assert.equal(second.armed.size, 0);
});

test("retrying a committed declaration after a read failure arms it without rewriting it", async (t) => {
  t.after(async () => {
    await subscriptions._deactivateAll();
    internal.RegisterTriggerType.unregister(TYPE_ID);
  });
  procedures.clear();
  const type = recordingType();
  internal.RegisterTriggerType.register(TYPE_ID, type);
  await subscriptions.hydrate();
  const {
    DeclareProcedure,
  } = require("../dist/implementations/dms-automation/index.js");
  const { markModuleStarted } = require("../dist/runtime/readiness.js");
  markModuleStarted();
  const declaration = {
    id: "support.retry",
    name: "Retry",
    enabled: true,
    graph: JSON.parse(graphOn(TYPE_ID)),
  };
  t.mock.method(ProcedureRunModel.prototype, "renameProcedure", async () => {});
  t.mock.method(
    ProcedureRunModel.prototype,
    "markOlderVersions",
    async () => {},
  );
  t.mock.method(ProcedureModel.prototype, "get", async (id) =>
    procedures.has(id) ? structuredClone(procedures.get(id)) : undefined,
  );
  t.mock.method(ProcedureModel.prototype, "getAll", async () => [
    ...procedures.values(),
  ]);
  t.mock.method(ProcedureModel.prototype, "insert", async (doc) => {
    procedures.set(doc._id, structuredClone(doc));
    return [doc._id];
  });
  const read = t.mock.method(
    ProcedureModel.prototype,
    "listEnabled",
    async () => {
      throw new Error("transient read failure");
    },
  );
  await assert.rejects(DeclareProcedure(declaration), /transient read failure/);
  assert.equal(type.armed.size, 0);
  const committed = structuredClone(procedures.get(declaration.id));
  read.mock.restore();
  const result = await DeclareProcedure(declaration);
  assert.equal(result.status, "unchanged");
  assert.equal(type.armed.size, 1);
  const stored = procedures.get(declaration.id);
  assert.equal(stored.revision, committed.revision);
  assert.equal(stored.version, committed.version);
  assert.equal(stored.updated_at.getTime(), committed.updated_at.getTime());
  await subscriptions._deactivateAll();
  assert.equal(type.armed.size, 0);
});
