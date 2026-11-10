const assert = require("node:assert/strict");
const interfaceCore = require("@antelopejs/interface-core");
const Module = require("node:module");
const { load } = require("./helpers/module-load.cjs");
const { mock, test } = require("node:test");
const { Schema } = require("@antelopejs/interface-database");

Schema.get = () => ({ instance: () => ({ table: () => ({}) }) });

const TYPE_ID = "support.nightly-sweep";

/** @type {number[]} */
const armedAtRelease = [];
const armed = new Set();

/** @type {string[]} */
const commands = [];

const redis = {
  /** @type {string | undefined} */
  key: undefined,
  /** @type {Promise<void>} */
  answerSet: Promise.resolve(),
  /** @type {() => Promise<void>} */
  holdRelease: async () => {},
  async set(/** @type {string} */ _key, /** @type {string} */ value) {
    commands.push("set");
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
    commands.push(script.includes("'del'") ? "release" : "renew");
    if (script.includes("'del'")) await redis.holdRelease();
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
const { subscriptions } = require("../dist/runtime/subscriptions.js");

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

ProcedureModel.prototype.listEnabled = async () =>
  procedures.map((p) => ({ ...p }));
ProcedureModel.prototype.update = async () => 1;
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

/**
 * @param {string} id
 * @param {"singleton" | "replicated"} cluster
 * @param {{ beforeArm?: () => Promise<void>, onDeactivate?: () => void }} [hooks]
 */
function recordingType(id, cluster, hooks = {}) {
  return {
    id,
    name: id,
    description: "Records what it arms",
    icon: "i-lucide-ticket",
    configSchema: { type: "object" },
    outputSchema: { type: "object" },
    cluster,
    async activate() {
      await hooks.beforeArm?.();
      const handle = Symbol(id);
      armed.add(handle);
      return handle;
    },
    async deactivate(/** @type {symbol} */ handle) {
      armed.delete(handle);
      hooks.onDeactivate?.();
    },
  };
}

const REPLICATED_ID = "support.ticket-opened";

/** @param {...ReturnType<typeof recordingType>} types */
function registerOnly(...types) {
  internal.RegisterTriggerType.unregister(TYPE_ID);
  internal.RegisterTriggerType.unregister(REPLICATED_ID);
  for (const type of types)
    internal.RegisterTriggerType.register(type.id, type);
}

void test("an instance sends no SET or renew once its teardown began", async (t) => {
  mock.timers.enable({ apis: ["setInterval"] });
  t.after(() => mock.timers.reset());
  let tornDown = false;
  registerOnly(
    recordingType(TYPE_ID, "singleton"),
    recordingType(REPLICATED_ID, "replicated", {
      onDeactivate: () => {
        if (tornDown) return;
        tornDown = true;
        commands.length = 0;
        mock.timers.tick(10_000);
      },
    }),
  );
  procedures.push(procedureOn("P2", REPLICATED_ID));
  t.after(() => void procedures.pop());
  await automation.start();
  await until(() => armed.size === 2, "the leader to arm both triggers");

  await automation.destroy();

  assert.ok(tornDown, "the teardown ran");
  assert.deepEqual(commands, ["release"], "only the release follows");
  assert.equal(armed.size, 0);
});

void test("a promotion that outlasts the shutdown caps keeps the key and leaves nothing armed once it ends", async (t) => {
  armedAtRelease.length = 0;
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  /** @type {PromiseWithResolvers<void>} */
  const arming = Promise.withResolvers();
  /** @type {PromiseWithResolvers<void>} */
  const gate = Promise.withResolvers();
  t.after(() => gate.resolve());
  registerOnly(
    recordingType(TYPE_ID, "singleton", {
      beforeArm: async () => {
        arming.resolve();
        await gate.promise;
      },
    }),
    recordingType(REPLICATED_ID, "replicated"),
  );
  procedures.push(procedureOn("P2", REPLICATED_ID));
  t.after(() => void procedures.pop());
  await automation.start();
  await arming.promise;

  let returned = false;
  const stopping = automation.destroy().then(() => {
    returned = true;
  });
  for (let i = 0; i < 100 && !returned; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(1_000);
  }
  await stopping;

  assert.deepEqual(armedAtRelease, [], "the key is not released");
  assert.equal(redis.key !== undefined, true, "the key is left to expire");

  gate.resolve();
  for (let i = 0; i < 20; i++)
    await new Promise((resolve) => setImmediate(resolve));

  assert.equal(armed.size, 0, "nothing stays armed once the promotion ends");
  redis.key = undefined;
});

void test("a procedure edit while destroy() releases the key arms no singleton", async (t) => {
  armedAtRelease.length = 0;
  registerOnly(recordingType(TYPE_ID, "singleton"));
  /** @type {PromiseWithResolvers<void>} */
  const releasing = Promise.withResolvers();
  /** @type {PromiseWithResolvers<void>} */
  const answer = Promise.withResolvers();
  redis.holdRelease = async () => {
    releasing.resolve();
    await answer.promise;
  };
  t.after(() => {
    redis.holdRelease = async () => {};
  });
  await automation.start();
  await until(() => armed.size === 1, "the leader to arm its singleton");

  const stopping = automation.destroy();
  await releasing.promise;
  await subscriptions.onProcedureChange("P1");
  answer.resolve();
  await stopping;

  assert.deepEqual(armedAtRelease, [0], "no singleton is armed at the release");
  assert.equal(armed.size, 0);
});
