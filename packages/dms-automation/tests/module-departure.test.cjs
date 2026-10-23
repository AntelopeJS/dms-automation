const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  Events,
  GetResponsibleModule,
  ImplementInterface,
  RunWithResponsibleModule,
} = require("@antelopejs/interface-core");
const { Logging } = require("@antelopejs/interface-core/logging");
const { Schema } = require("@antelopejs/interface-database");
const automation = require("@antelopejs/interface-dms-automation");

// A project registers its own node types and stops (a hot reload, a stop):
// the core takes its registrations back, then invalidates its context. Its
// triggers must be torn down while they still can be, without an error, and
// a run on its steps fails, like any other error, still stored by this module.

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
const implementation = require("../dist/implementations/dms-automation/index.js");
const { subscriptions } = require("../dist/runtime/subscriptions.js");

const SELF = "dms-automation";
const PROJECT = "project";

const node = (id, kind, typeId) => ({
  id,
  kind,
  typeId,
  config: {},
  position: { x: 0, y: 0 },
});
const edge = (from, to) => ({
  id: `${from}-${to}`,
  from: { node: from },
  to: { node: to },
});

const procedure = {
  _id: "P1",
  name: "Ticket follow-up",
  enabled: true,
  graph: JSON.stringify({
    nodes: [
      node("start", "trigger", "project.ticket"),
      node("wait", "action", "project.wait"),
      node("after", "action", "project.after"),
    ],
    triggerEdges: [edge("start", "wait"), edge("wait", "after")],
    dataEdges: [],
  }),
  revision: 1,
  version: 1,
};

const runs = [];
Object.assign(ProcedureModel.prototype, {
  listEnabled: async () => [{ ...procedure }],
  update: async () => 1,
});
Object.assign(AutomationTemplateModel.prototype, { listAll: async () => [] });
Object.assign(TypeSwitchModel.prototype, { getAll: async () => [] });
Object.assign(ProcedureRunModel.prototype, {
  insert: async (row) => {
    // Throws when the run goes on in a context that is no longer valid.
    runs.push({ ...row, storedBy: GetResponsibleModule() });
    return [`run-${runs.length}`];
  },
});

async function until(condition, what) {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** The project's own types: a trigger, and two steps the run goes through. */
function projectTypes() {
  const project = { armed: new Set(), emit: undefined };
  const gate = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const base = {
    description: "",
    icon: "i-ph-ticket",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
  };
  project.trigger = {
    ...base,
    id: "project.ticket",
    name: "Ticket opened",
    configSchema: { type: "object" },
    cluster: "replicated",
    async activate(_config, emit) {
      const handle = Symbol("handle");
      project.armed.add(handle);
      project.emit = emit;
      return handle;
    },
    async deactivate(handle) {
      project.armed.delete(handle);
    },
  };
  project.wait = {
    ...base,
    id: "project.wait",
    name: "Wait",
    async execute() {
      entered.resolve();
      await gate.promise;
      return {};
    },
  };
  project.after = {
    ...base,
    id: "project.after",
    name: "After",
    async execute() {
      return {};
    },
  };
  return { project, gate, entered };
}

test("a departing project's triggers go quietly and its run fails", async (t) => {
  const errors = t.mock.method(Logging, "Error", () => {});
  RunWithResponsibleModule(SELF, () =>
    ImplementInterface(automation, implementation),
  );
  await RunWithResponsibleModule(SELF, () => subscriptions.hydrate());

  const { project, gate, entered } = projectTypes();
  RunWithResponsibleModule(PROJECT, () => {
    automation.RegisterTriggerType(project.trigger);
    automation.RegisterActionType(project.wait);
    automation.RegisterActionType(project.after);
  });
  await until(() => project.armed.size === 1, "the project's trigger to arm");

  // The project's own code fires its trigger, in its own context.
  RunWithResponsibleModule(PROJECT, () => project.emit({ ticket: 1 }));
  await entered.promise;

  // It stops while the run waits on its step.
  Events.ModuleDestroyed.emit(PROJECT);
  assert.equal(project.armed.size, 0, "torn down before its context went");
  gate.resolve();

  await until(() => runs.length === 1, "the run to be stored");
  const [run] = runs;
  assert.equal(run.status, "failed");
  assert.match(run.errorMessage, /project\.after/);
  assert.equal(run.failedNodeId, "after");
  assert.equal(run.storedBy, SELF);

  // A timer the project left behind starts nothing.
  project.emit({ ticket: 2 });
  await subscriptions.onProcedureChange();
  assert.equal(runs.length, 1);
  assert.deepEqual(
    errors.mock.calls.map((call) => String(call.arguments[0])),
    [],
  );
  await subscriptions._deactivateAll();
});

// The executor alone: a module gone mid-run is an ordinary step error.

const { ModuleContextInvalidatedError } = require("@antelopejs/interface-core");
const { builtinTriggers } = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { run } = require("../dist/runtime/executor.js");

for (const type of builtinTriggers) registry.addTrigger(type.id, type);

function action(id, execute) {
  registry.addAction(id, {
    id,
    name: id,
    description: "",
    icon: "",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    execute,
  });
}

test("a Try/Catch catches a step whose module is gone, like any error", async () => {
  const caught = [];
  action("tests.gone", async () => {
    throw new ModuleContextInvalidatedError(PROJECT);
  });
  action("tests.caught", async () => {
    caught.push(true);
    return {};
  });
  const result = await run(
    {
      nodes: [
        node("t", "trigger", "manual"),
        node("try", "tryCatch"),
        node("gone", "action", "tests.gone"),
        node("caught", "action", "tests.caught"),
      ],
      triggerEdges: [
        edge("t", "try"),
        { ...edge("try", "gone"), from: { node: "try", branch: "try" } },
        { ...edge("try", "caught"), from: { node: "try", branch: "catch" } },
      ],
      dataEdges: [],
    },
    "t",
    {},
  );
  assert.equal(result.status, "ok");
  assert.deepEqual(caught, [true]);
});
