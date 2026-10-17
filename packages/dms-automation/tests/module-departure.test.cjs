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
// a run on its steps must end as cancelled, still stored by this module.

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

test("a departing project's triggers go quietly and its run is cancelled", async (t) => {
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
  assert.equal(run.status, "cancelled");
  assert.match(run.errorMessage, /"project\.after" was unregistered/);
  assert.equal(run.failedNodeId, undefined);
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

// The executor alone: what ends a run as cancelled, and what still fails it.

const { ModuleContextInvalidatedError } = require("@antelopejs/interface-core");
const { builtinTriggers } = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { run } = require("../dist/runtime/executor.js");

for (const type of builtinTriggers) registry.addTrigger(type.id, type);

const manual = node("t", "trigger", "manual");

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

const ranCatch = [];
action("tests.gone", async () => {
  throw new ModuleContextInvalidatedError(PROJECT);
});
action("tests.caught", async () => {
  ranCatch.push(true);
  return {};
});

test("a step whose module is gone cancels the run, past a Try/Catch", async () => {
  const result = await run(
    {
      nodes: [
        manual,
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
  assert.equal(result.status, "cancelled");
  assert.match(result.errorMessage, /"tests\.gone" was unloaded/);
  assert.equal(result.failedNodeId, undefined);
  assert.deepEqual(ranCatch, []);
  assert.equal(
    result.logs.entries.at(-1).message.startsWith("run cancelled"),
    true,
  );
});

test("a Retry does not try a step whose module is gone again", async () => {
  let attempts = 0;
  action("tests.gone-counted", async () => {
    attempts += 1;
    throw new ModuleContextInvalidatedError(PROJECT);
  });
  const result = await run(
    {
      nodes: [
        manual,
        { ...node("retry", "retry"), config: { maxAttempts: 3 } },
        node("gone", "action", "tests.gone-counted"),
      ],
      triggerEdges: [
        edge("t", "retry"),
        { ...edge("retry", "gone"), from: { node: "retry", branch: "body" } },
      ],
      dataEdges: [],
    },
    "t",
    {},
  );
  assert.equal(result.status, "cancelled");
  assert.equal(attempts, 1);
});

test("a type unregistered during the run cancels it; one never there fails it", async () => {
  action("tests.first", async () => {
    registry.removeAction("tests.second");
    return {};
  });
  action("tests.second", async () => ({}));
  const graph = {
    nodes: [
      manual,
      node("first", "action", "tests.first"),
      node("second", "action", "tests.second"),
    ],
    triggerEdges: [edge("t", "first"), edge("first", "second")],
    dataEdges: [],
  };
  const cancelled = await run(graph, "t", {});
  assert.equal(cancelled.status, "cancelled");

  // Gone before the run started: the procedure cannot run, a failure.
  const failed = await run(graph, "t", {});
  assert.equal(failed.status, "failed");
  assert.equal(failed.failedNodeId, "second");
});
