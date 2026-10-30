const assert = require("node:assert/strict");
const { test } = require("node:test");
const { builtinActions, builtinTriggers } = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { run } = require("../dist/runtime/executor.js");
const { realEffectStepsOf } = require("../dist/runtime/sideEffects.js");

/**
 * A test run of a draft must not act behind the user's back: an action that
 * can simulate does, and the steps that would act for real are listed so the
 * builder asks before the test, not after.
 */

for (const t of builtinTriggers) registry.addTrigger(t.id, t);
for (const a of builtinActions) registry.addAction(a.id, a);

const sent = [];
const SCHEMA = { type: "object" };
const OUTPUT = { type: "object", properties: { id: { type: "string" } } };

/** An action that acts and can pretend to. */
registry.addAction("acme.send", {
  id: "acme.send",
  name: "$acme.send.name",
  description: "",
  icon: "i-ph-envelope",
  inputSchema: SCHEMA,
  outputSchema: OUTPUT,
  async execute(_input, ctx) {
    sent.push({ kind: "send", dryRun: ctx.dryRun });
    return { id: "real" };
  },
  async dryRun(_input, ctx) {
    assert.equal(ctx.dryRun, true);
    return { id: "simulated" };
  },
});
registry.addAction("acme.notify", {
  id: "acme.notify",
  name: "Notify",
  description: "",
  icon: "i-ph-bell",
  inputSchema: SCHEMA,
  outputSchema: OUTPUT,
  async execute(_input, ctx) {
    sent.push({ kind: "notify", dryRun: ctx.dryRun });
    return { id: "notified" };
  },
});
registry.addAction("acme.read", {
  id: "acme.read",
  name: "Read",
  description: "",
  icon: "i-ph-eye",
  sideEffects: false,
  inputSchema: SCHEMA,
  outputSchema: OUTPUT,
  async execute() {
    return { id: "read" };
  },
  async dryRun() {
    throw new Error("a pure action is never simulated");
  },
});

function node(id, kind, typeId, extra = {}) {
  const n = { id, kind, config: {}, position: { x: 0, y: 0 }, ...extra };
  if (typeId) n.typeId = typeId;
  return n;
}

function edge(from, to) {
  return { id: `${from}-${to}`, from: { node: from }, to: { node: to } };
}

function graph() {
  return {
    nodes: [
      node("t", "trigger", "manual"),
      node("send", "action", "acme.send"),
      node("notify", "action", "acme.notify", { label: "Tell the team" }),
      node("read", "action", "acme.read"),
      node("log", "action", "log.message"),
    ],
    triggerEdges: [
      edge("t", "send"),
      edge("send", "notify"),
      edge("notify", "read"),
      edge("read", "log"),
    ],
    dataEdges: [],
  };
}

function outputOf(result, nodeId) {
  const entry = result.logs.entries.findLast(
    (e) => e.nodeId === nodeId && e.message === "executed",
  );
  return entry?.value.output.value;
}

void test("a dry run simulates the actions that can and runs the others", async () => {
  sent.length = 0;
  const result = await run(graph(), "t", {}, { dryRun: true });
  assert.equal(result.status, "ok");
  assert.deepEqual(outputOf(result, "send"), { id: "simulated" });
  assert.deepEqual(outputOf(result, "read"), { id: "read" });
  assert.deepEqual(sent, [{ kind: "notify", dryRun: true }]);
  assert.ok(
    result.logs.entries.some(
      (e) => e.nodeId === "send" && e.message.startsWith("Simulated"),
    ),
  );
});

void test("a real run executes every action", async () => {
  sent.length = 0;
  const result = await run(graph(), "t", {});
  assert.equal(result.status, "ok");
  assert.deepEqual(outputOf(result, "send"), { id: "real" });
  assert.deepEqual(sent, [
    { kind: "send", dryRun: false },
    { kind: "notify", dryRun: false },
  ]);
});

void test("the real effects of a draft are the actions that cannot simulate", () => {
  assert.deepEqual(realEffectStepsOf(graph()), [
    {
      nodeId: "notify",
      typeId: "acme.notify",
      typeName: "Notify",
      label: "Tell the team",
    },
  ]);
});

void test("real effects inside a group are listed under their flattened id", () => {
  const g = {
    nodes: [
      node("t", "trigger", "manual"),
      node("g", "group", undefined, {
        ports: [{ name: "in", kind: "trigger", direction: "in" }],
        subgraph: {
          nodes: [
            node("gi", "groupInput"),
            node("go", "groupOutput"),
            node("inner", "action", "acme.notify"),
          ],
          triggerEdges: [],
          dataEdges: [],
        },
      }),
    ],
    triggerEdges: [edge("t", "g")],
    dataEdges: [],
  };
  const steps = realEffectStepsOf(g);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].typeId, "acme.notify");
  assert.match(steps[0].nodeId, /^g__inner$/);
});

void test("a draft of pure and simulated actions has no real effect", () => {
  const g = graph();
  g.nodes = g.nodes.filter((n) => n.id !== "notify");
  assert.deepEqual(realEffectStepsOf(g), []);
});
