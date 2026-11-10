const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Logging } = require("@antelopejs/interface-core/logging");
const { Schema } = require("@antelopejs/interface-database");

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

/** @param {string} typeId */
const procedureOn = (typeId) => ({
  _id: typeId,
  name: typeId,
  enabled: true,
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
  revision: 1,
  version: 1,
});

/** @type {string[]} */
const runs = [];
ProcedureModel.prototype.listEnabled = async () => [
  procedureOn("schedule"),
  procedureOn("ticket"),
];
ProcedureModel.prototype.update = async () => 1;
Object.assign(AutomationTemplateModel.prototype, { listAll: async () => [] });
Object.assign(TypeSwitchModel.prototype, { getAll: async () => [] });
Object.assign(ProcedureRunModel.prototype, {
  /** @param {{ procedureId: string }} row */
  insert: async (row) => {
    runs.push(row.procedureId);
    return [`run-${runs.length}`];
  },
});

/**
 * A trigger type that keeps the `emit` its activation got.
 * @param {string} id
 * @param {"singleton" | "replicated"} cluster
 */
function capturingType(id, cluster) {
  const type = {
    id,
    name: id,
    description: "",
    icon: "i-lucide-zap",
    configSchema: { type: "object" },
    outputSchema: { type: "object" },
    cluster,
    /** @type {((payload: unknown) => void) | undefined} */
    emit: undefined,
    /** @param {unknown} _config @param {(payload: unknown) => void} emit */
    async activate(_config, emit) {
      type.emit = emit;
      return Symbol(id);
    },
    async deactivate() {},
  };
  return type;
}

/**
 * @param {() => boolean} condition
 * @param {string} what
 */
async function until(condition, what) {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

void test("an armed singleton trigger fires nothing once its instance no longer leads", async (t) => {
  t.mock.method(Logging, "Warn", () => {});
  let leading = true;
  subscriptions.useLeadershipSource(() => leading);
  await subscriptions.hydrate();
  const schedule = capturingType("schedule", "singleton");
  const ticket = capturingType("ticket", "replicated");
  internal.RegisterTriggerType.register(schedule.id, schedule);
  internal.RegisterTriggerType.register(ticket.id, ticket);
  await until(() => schedule.emit && ticket.emit, "both triggers to arm");

  schedule.emit?.({});
  await until(() => runs.includes("schedule"), "the leader's singleton run");

  leading = false;
  runs.length = 0;
  schedule.emit?.({});
  ticket.emit?.({});
  await until(() => runs.includes("ticket"), "the replicated run");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(runs, ["ticket"], "only the replicated trigger ran");
  await subscriptions._deactivateAll();
});
