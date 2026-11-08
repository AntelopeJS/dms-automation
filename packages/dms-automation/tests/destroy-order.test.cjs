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

const redis = {
  key: /** @type {string | undefined} */ (undefined),
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
    GetInterfaceInstances: () => [{}],
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

Object.assign(ProcedureModel.prototype, {
  listEnabled: async () => [
    {
      _id: "P1",
      name: "Nightly sweep",
      enabled: true,
      revision: 1,
      version: 1,
      graph: JSON.stringify({
        nodes: [
          {
            id: "start",
            kind: "trigger",
            typeId: TYPE_ID,
            config: {},
            position: { x: 0, y: 0 },
          },
        ],
        triggerEdges: [],
        dataEdges: [],
      }),
    },
  ],
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

void test("a SET that wins the key while destroy() runs arms nothing before the release", async () => {
  armedAtRelease.length = 0;
  /** @type {PromiseWithResolvers<void>} */
  const answer = Promise.withResolvers();
  redis.answerSet = answer.promise;
  await automation.start();
  assert.equal(armed.size, 0);

  const stopping = automation.destroy();
  answer.resolve();
  await stopping;

  assert.deepEqual(
    armedAtRelease,
    [0],
    "a promotion during shutdown arms no singleton",
  );
  assert.equal(armed.size, 0);
  assert.equal(redis.key, undefined);
});
