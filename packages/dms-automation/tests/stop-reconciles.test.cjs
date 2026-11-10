const assert = require("node:assert/strict");
const interfaceCore = require("@antelopejs/interface-core");
const Module = require("node:module");
const { mock, test } = require("node:test");
const { Schema } = require("@antelopejs/interface-database");

Schema.get = () => ({ instance: () => ({ table: () => ({}) }) });

/** @type {Record<string, unknown>} */
const mocks = {
  "@antelopejs/interface-dms/page": { AddFrontendModule() {} },
  "@antelopejs/interface-database-decorators": {
    ...require("@antelopejs/interface-database-decorators"),
    RegisterSchema: async () => {},
  },
  "@antelopejs/interface-core": {
    ...interfaceCore,
    ImplementInterface() {},
    GetInterfaceInstances: () => [],
  },
  "./db": {},
  "./pages": {},
  "./routes": {},
  "./runtime/retention": {
    configureRetention() {},
    startRetention() {},
    stopRetention() {},
  },
};
/**
 * @param {unknown} value
 * @returns {value is (this: unknown, request: string, ...rest: unknown[]) => unknown}
 */
function isLoader(value) {
  return value instanceof Function;
}

/** @type {unknown} */
const load = Module._load;
if (!isLoader(load)) throw new Error("Module._load is not available");
mock.method(
  Module,
  "_load",
  (
    /** @type {string} */ name,
    /** @type {unknown} */ parent,
    /** @type {boolean} */ isMain,
  ) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    /** @type {unknown} */
    const loaded = load.call(Module, name, parent, isMain);
    return loaded;
  },
);

const automation = require("../dist/index.js");
const { ProcedureModel } = require("../dist/db/models/procedure.model.js");
const {
  AutomationTemplateModel,
} = require("../dist/db/models/automation_template.model.js");
const { TypeSwitchModel } = require("../dist/db/models/type_switch.model.js");
const { internal } = require("../dist/implementations/dms-automation/index.js");

const TICKET = "project.ticket";
const INVOICE = "project.invoice";

/** @param {string} id @param {string} typeId */
const procedureOn = (id, typeId) => ({
  _id: id,
  name: id,
  enabled: true,
  revision: 1,
  version: 1,
  graph: JSON.stringify({
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
  }),
});

const database = { gone: false, readsWhileGone: 0 };

/** @type {Promise<never>} */
const unanswered = new Promise(() => {});

ProcedureModel.prototype.listEnabled = async () => {
  if (!database.gone)
    return [procedureOn("P1", TICKET), procedureOn("P2", INVOICE)];
  database.readsWhileGone += 1;
  return unanswered;
};
ProcedureModel.prototype.update = async () => 1;
Object.assign(AutomationTemplateModel.prototype, { listAll: async () => [] });
Object.assign(TypeSwitchModel.prototype, { getAll: async () => [] });

/** @type {Set<symbol>} */
const armed = new Set();

/** @param {string} id */
function triggerType(id) {
  return {
    id,
    name: id,
    description: "Records what it arms",
    icon: "i-lucide-ticket",
    configSchema: { type: "object" },
    outputSchema: { type: "object" },
    cluster: "replicated",
    async activate() {
      const handle = Symbol(id);
      armed.add(handle);
      return handle;
    },
    async deactivate(/** @type {symbol} */ handle) {
      armed.delete(handle);
    },
  };
}

async function until(/** @type {() => boolean} */ condition, what) {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** @param {Promise<void>} work @param {number} ms */
function settlesWithin(work, ms) {
  return Promise.race([
    work.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

void test("a trigger type that leaves after stop() queues no reconcile for destroy() to wait on", async () => {
  internal.RegisterTriggerType.register(TICKET, triggerType(TICKET));
  internal.RegisterTriggerType.register(INVOICE, triggerType(INVOICE));
  await automation.construct({});
  await automation.start();
  await until(() => armed.size === 2, "both triggers to arm");

  automation.stop();
  database.gone = true;
  internal.RegisterTriggerType.unregister(INVOICE);
  await until(() => armed.size === 1, "the departing type's trigger to go");
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(
    await settlesWithin(automation.destroy(), 1_000),
    true,
    "destroy() returns without waiting out its cap",
  );
  assert.equal(
    database.readsWhileGone,
    0,
    "nothing read the database after stop()",
  );
  assert.equal(armed.size, 0);
});

void test("a trigger type registered after a restart arms its procedures", async () => {
  database.gone = false;
  internal.RegisterTriggerType.unregister(TICKET);
  await automation.start();
  assert.equal(armed.size, 0);

  internal.RegisterTriggerType.register(TICKET, triggerType(TICKET));
  internal.RegisterTriggerType.register(INVOICE, triggerType(INVOICE));
  await until(() => armed.size === 2, "the late types to arm");

  automation.stop();
  await automation.destroy();
  assert.equal(armed.size, 0);
});
