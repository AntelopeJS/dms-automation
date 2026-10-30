const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Schema } = require("@antelopejs/interface-database");

Schema.get = () => ({ instance: () => ({ table: () => ({}) }) });

const { ProcedureModel } = require("../dist/db/models/procedure.model.js");
const {
  AutomationTemplateModel,
} = require("../dist/db/models/automation_template.model.js");
const { TypeSwitchModel } = require("../dist/db/models/type_switch.model.js");
const { subscriptions } = require("../dist/runtime/subscriptions.js");
const { internal } = require("../dist/implementations/dms-automation/index.js");

const TYPE_ID = "support.ticket-opened";

/** @param {string} typeId */
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

/**
 * @typedef {Partial<import("../dist/db/tables/procedure.table.js").Procedure> &
 *   Pick<
 *     import("../dist/db/tables/procedure.table.js").Procedure,
 *     "_id" | "name" | "enabled" | "graph" | "revision" | "version"
 *   >} StoredProcedure
 */

/** @type {Map<string, StoredProcedure>} */
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
  update: async (
    /** @type {string} */ id,
    /** @type {Partial<StoredProcedure>} */ patch,
  ) => {
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

/** @param {string} id */
const armErrorOf = (id) => procedures.get(id).armErrors ?? "";

void test("a late trigger type arms its procedures, and a reload re-arms them", async () => {
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

  internal.RegisterTriggerType.unregister(TYPE_ID);
  const second = recordingType();
  internal.RegisterTriggerType.register(TYPE_ID, second);
  await until(() => first.armed.size === 0, "every old handle to be torn down");
  await until(() => second.armed.size === 2, "the new definition to arm both");

  internal.RegisterTriggerType.unregister(TYPE_ID);
  await until(() => second.armed.size === 0, "teardown");
  await until(() => /unknownType/.test(armErrorOf("P1")), "the arm error");

  await subscriptions._deactivateAll();
});

void test("a follower leaves a singleton trigger unarmed until it leads, and disarms it when it stops leading", async (t) => {
  t.after(async () => {
    subscriptions.useLeadershipSource(() => true);
    internal.RegisterTriggerType.unregister(TYPE_ID);
    await subscriptions._deactivateAll();
  });
  const singleton = recordingType();
  singleton.cluster = "singleton";
  internal.RegisterTriggerType.register(TYPE_ID, singleton);
  let leader = false;
  subscriptions.useLeadershipSource(() => leader);

  await subscriptions.hydrate();
  assert.equal(singleton.armed.size, 0);

  leader = true;
  await subscriptions.onBecameLeader();
  assert.equal(singleton.armed.size, 2);

  leader = false;
  await subscriptions.onLostLeadership();
  assert.equal(singleton.armed.size, 0);
});

void test("a reload during activation releases each definition's own handles", async (t) => {
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
  await subscriptions.onProcedureChange();
  assert.equal(first.armed.size, 0);
  assert.equal(second.armed.size, 2);
  await subscriptions._deactivateAll();
  assert.equal(second.armed.size, 0);
});
