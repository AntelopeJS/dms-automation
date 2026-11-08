const assert = require("node:assert/strict");
const interfaceCore = require("@antelopejs/interface-core");
const Module = require("node:module");
const { mock, test } = require("node:test");
const { Schema } = require("@antelopejs/interface-database");

Schema.get = () => ({ instance: () => ({ table: () => ({}) }) });

const TYPE_ID = "support.nightly-sweep";

/** @type {number[]} */
const armedAtRelease = [];
const armed = new Set();
let redisProvided = true;

const redis = {
  key: /** @type {string | undefined} */ (undefined),
  /** @type {Promise<void>} */
  answerSet: Promise.resolve(),
  async set(/** @type {string} */ _key, /** @type {string} */ value) {
    await redis.answerSet;
    if (redis.key !== undefined) return null;
    redis.key = value;
    return "OK";
  },
  async eval(
    /** @type {string} */ script,
    /** @type {number} */ _keys,
    /** @type {string} */ _key,
    /** @type {string} */ owner,
  ) {
    if (redis.key !== owner) return 0;
    if (script.includes("'del'")) {
      armedAtRelease.push(armed.size);
      redis.key = undefined;
    }
    return 1;
  },
  async publish() {
    return 0;
  },
  duplicate() {
    return {
      on() {},
      async subscribe() {},
      async unsubscribe() {},
      async quit() {},
    };
  },
};

/** @type {Record<string, unknown>} */
const mocks = {
  "@antelopejs/interface-redis": { GetClient: async () => redis },
  "@antelopejs/interface-dms/page": { AddFrontendModule() {} },
  "@antelopejs/interface-database-decorators": {
    ...require("@antelopejs/interface-database-decorators"),
    RegisterSchema: async () => {},
  },
  "@antelopejs/interface-core": {
    ...interfaceCore,
    ImplementInterface() {},
    GetInterfaceInstances: () => (redisProvided ? [{}] : []),
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
/** @type {unknown} */
const load = Module._load;
assert.ok(load instanceof Function, "Module._load is not available");
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

const procedures = [procedureOn("P1", TYPE_ID)];

Object.assign(ProcedureModel.prototype, {
  listEnabled: async () => procedures.map((p) => ({ ...p })),
  update: async () => 1,
});
Object.assign(AutomationTemplateModel.prototype, { listAll: async () => [] });
Object.assign(TypeSwitchModel.prototype, { getAll: async () => [] });

async function until(/** @type {() => boolean} */ condition, what) {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

void test("destroy() tears the singleton triggers down before it releases the leader key", async () => {
  internal.RegisterTriggerType.register(TYPE_ID, {
    id: TYPE_ID,
    name: "Nightly sweep",
    description: "Fires once a night on the leader",
    icon: "i-lucide-moon",
    configSchema: { type: "object" },
    outputSchema: { type: "object" },
    cluster: "singleton",
    async activate() {
      const handle = Symbol("handle");
      armed.add(handle);
      return handle;
    },
    async deactivate(/** @type {symbol} */ handle) {
      armed.delete(handle);
    },
  });
  await automation.construct({ cluster: { driver: "redis" } });
  await automation.start();
  await until(() => armed.size === 1, "the leader to arm its singleton");

  await automation.destroy();

  assert.deepEqual(
    armedAtRelease,
    [0],
    "no singleton is armed when the key is released",
  );
  assert.equal(armed.size, 0);
  assert.equal(redis.key, undefined);
});

void test("a promotion still arming when destroy() starts is disarmed before the release", async () => {
  armedAtRelease.length = 0;
  internal.RegisterTriggerType.unregister(TYPE_ID);
  /** @type {PromiseWithResolvers<void>} */
  const arming = Promise.withResolvers();
  /** @type {PromiseWithResolvers<void>} */
  const gate = Promise.withResolvers();
  internal.RegisterTriggerType.register(TYPE_ID, {
    id: TYPE_ID,
    name: "Nightly sweep",
    description: "Fires once a night on the leader",
    icon: "i-lucide-moon",
    configSchema: { type: "object" },
    outputSchema: { type: "object" },
    cluster: "singleton",
    async activate() {
      arming.resolve();
      await gate.promise;
      const handle = Symbol("handle");
      armed.add(handle);
      return handle;
    },
    async deactivate(/** @type {symbol} */ handle) {
      armed.delete(handle);
    },
  });
  await automation.start();
  await arming.promise;

  redisProvided = false;
  const stopping = automation.destroy();
  gate.resolve();
  await stopping;
  redisProvided = true;

  assert.deepEqual(
    armedAtRelease,
    [0],
    "the promotion's singleton is disarmed before the release",
  );
  assert.equal(armed.size, 0, "destroy() leaves no singleton armed");
  assert.equal(redis.key, undefined);
});

void test("a SET that wins the key during the teardown arms no trigger after destroy() returns", async () => {
  armedAtRelease.length = 0;
  const REPLICATED_ID = "support.ticket-opened";
  procedures.push(procedureOn("P2", REPLICATED_ID));
  /** @type {PromiseWithResolvers<void>} */
  const answer = Promise.withResolvers();
  redis.answerSet = answer.promise;
  let activations = 0;
  internal.RegisterTriggerType.register(REPLICATED_ID, {
    id: REPLICATED_ID,
    name: "Ticket opened",
    description: "Fires on every instance",
    icon: "i-lucide-ticket",
    configSchema: { type: "object" },
    outputSchema: { type: "object" },
    cluster: "replicated",
    async activate() {
      if (activations++ > 0)
        await new Promise((resolve) => setTimeout(resolve, 20));
      const handle = Symbol("replicated");
      armed.add(handle);
      return handle;
    },
    async deactivate(/** @type {symbol} */ handle) {
      armed.delete(handle);
      answer.resolve();
    },
  });
  await automation.start();
  assert.equal(armed.size, 1, "the replicated trigger is armed");

  await automation.destroy();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(armed.size, 0, "destroy() leaves no trigger armed");
  assert.equal(redis.key, undefined);
});

void test("a step-down during the teardown arms no trigger after destroy() returns", async (t) => {
  mock.timers.enable({ apis: ["setInterval"] });
  t.after(() => mock.timers.reset());
  const REPLICATED_ID = "support.ticket-opened";
  internal.RegisterTriggerType.unregister(TYPE_ID);
  internal.RegisterTriggerType.unregister(REPLICATED_ID);
  /** @param {string} id @param {"singleton" | "replicated"} cluster @param {(handle: symbol) => void} onDeactivate */
  const trigger = (id, cluster, onDeactivate) => {
    let activations = 0;
    return {
      id,
      name: id,
      description: "Records what it arms",
      icon: "i-lucide-ticket",
      configSchema: { type: "object" },
      outputSchema: { type: "object" },
      cluster,
      async activate() {
        if (activations++ > 0)
          await new Promise((resolve) => setTimeout(resolve, 20));
        const handle = Symbol(id);
        armed.add(handle);
        return handle;
      },
      async deactivate(/** @type {symbol} */ handle) {
        armed.delete(handle);
        onDeactivate(handle);
      },
    };
  };
  let renewed = false;
  internal.RegisterTriggerType.register(
    TYPE_ID,
    trigger(TYPE_ID, "singleton", () => {}),
  );
  internal.RegisterTriggerType.register(
    REPLICATED_ID,
    trigger(REPLICATED_ID, "replicated", () => {
      if (renewed) return;
      renewed = true;
      redis.key = "peer";
      mock.timers.tick(10_000);
    }),
  );
  await automation.start();
  await until(() => armed.size === 2, "the leader to arm both triggers");

  await automation.destroy();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(renewed, "a renew answered 0 during the teardown");
  assert.equal(armed.size, 0, "destroy() leaves no trigger armed");
});
