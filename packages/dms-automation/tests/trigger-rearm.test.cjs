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
