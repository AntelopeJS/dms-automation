const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { logAction } = require("../dist/runtime/builtins/actions/log.js");
const {
  manualTrigger,
} = require("../dist/runtime/builtins/triggers/manual.js");
const { run } = require("../dist/runtime/executor.js");
const { traceOf } = require("../dist/runtime/trace.js");
const { stepName } = require("../dist/runtime/describe.js");

registry.addTrigger("manual", manualTrigger);
registry.addAction("log.message", logAction);
registry.addAction("test.fail", {
  id: "test.fail",
  name: "Fail",
  execute: async () => {
    throw new Error("HTTP 502 Bad Gateway");
  },
});

/**
 * @param {string} id
 * @param {string} kind
 * @param {string} typeId
 * @param {string} [label]
 * @returns {import("../dist/types/graph.js").GraphNode}
 */
function node(id, kind, typeId, label) {
  const n = {
    id,
    kind,
    typeId,
    config: { message: "hello" },
    position: { x: 0, y: 0 },
  };
  if (label) n.label = label;
  return n;
}

const graph = {
  nodes: [
    node("t", "trigger", "manual", "Run by hand"),
    node("log", "action", "log.message", "Say hello"),
    node("fail", "action", "test.fail", "Push to ERP"),
    node("after", "action", "log.message"),
  ],
  triggerEdges: [
    { id: "e1", from: { node: "t" }, to: { node: "log" } },
    { id: "e2", from: { node: "log" }, to: { node: "fail" } },
    { id: "e3", from: { node: "fail" }, to: { node: "after" } },
  ],
  dataEdges: [],
};

void test("a failed run names the node it failed at", async () => {
  const result = await run(graph, "t", { a: 1 });
  assert.equal(result.status, "failed");
  assert.equal(result.failedNodeId, "fail");
  assert.equal(result.errorMessage, "HTTP 502 Bad Gateway");
});

void test("the trace lists the trigger, the steps that ran and the skipped ones", async () => {
  const result = await run(graph, "t", { a: 1 });
  const trace = traceOf(graph, result.logs, { nodeId: "t", payload: { a: 1 } });
  assert.deepEqual(
    trace.steps.map((s) => [s.nodeId, s.status]),
    [
      ["t", "ok"],
      ["log", "ok"],
      ["fail", "failed"],
    ],
  );
  const failed = trace.steps[2];
  assert.equal(failed.error, "HTTP 502 Bad Gateway");
  assert.ok(Number.isFinite(failed.durationMs));
  assert.equal(trace.steps[1].name.label, "Say hello");
  assert.deepEqual(
    trace.skipped.map((s) => s.nodeId),
    ["after"],
  );
});

void test("a step is named by its label, then by its type", () => {
  assert.equal(stepName(graph, "fail").label, "Push to ERP");
  assert.equal(stepName(graph, "after").typeName, logAction.name);
  assert.deepEqual(stepName(graph, "nope"), { nodeId: "nope" });
});

const { stepDurations } = require("../dist/runtime/trace.js");
const { stepNamesOf } = require("../dist/runtime/describe.js");

/**
 * @param {string} id
 * @param {string} kind
 * @param {import("../dist/types/dataValue.js").DataRecord} [config]
 * @returns {import("../dist/types/graph.js").GraphNode}
 */
function flow(id, kind, config = {}) {
  return { id, kind, config, position: { x: 0, y: 0 } };
}

/**
 * @param {string} id
 * @param {string} from
 * @param {string} to
 * @param {string} [branch]
 * @returns {import("../dist/types/graph.js").TriggerEdge}
 */
function edge(id, from, to, branch) {
  const e = { id, from: { node: from }, to: { node: to } };
  if (branch) e.from.branch = branch;
  return e;
}

/**
 * A loop over three items, a Try/Catch whose try fails, an If that takes
 * `then`, then a step that fails for good.
 */
const flowGraph = {
  nodes: [
    node("t", "trigger", "manual"),
    flow("each", "foreach", { items: [1, 2, 3] }),
    node("item", "action", "log.message", "Log the item"),
    flow("guard", "tryCatch"),
    node("bad", "action", "test.fail", "Push to ERP (try)"),
    node("note", "action", "log.message", "Note the error"),
    flow("choose", "if", { cond: true }),
    node("yes", "action", "log.message"),
    node("no", "action", "log.message", "Queue standard pickup"),
    node("boom", "action", "test.fail", "Book courier"),
    node("after", "action", "log.message", "Notify warehouse"),
  ],
  triggerEdges: [
    edge("e-t", "t", "each"),
    edge("e-body", "each", "item", "body"),
    edge("e-each", "each", "guard"),
    edge("e-try", "guard", "bad", "try"),
    edge("e-catch", "guard", "note", "catch"),
    edge("e-guard", "guard", "choose"),
    edge("e-then", "choose", "yes", "then"),
    edge("e-else", "choose", "no", "else"),
    edge("e-yes", "yes", "boom"),
    edge("e-boom", "boom", "after"),
  ],
  dataEdges: [],
};

/** @param {import("../dist/runtime/trace.js").TraceOptions} [options] */
async function flowTrace(options) {
  const result = await run(flowGraph, "t", {});
  return {
    result,
    trace: traceOf(
      flowGraph,
      result.logs,
      { nodeId: "t", payload: {} },
      options,
    ),
  };
}

void test("loop iterations sit under their loop, numbered", async () => {
  const { trace } = await flowTrace();
  const loop = trace.steps.findIndex((s) => s.nodeId === "each");
  const items = trace.steps.filter((s) => s.nodeId === "item");
  assert.deepEqual(
    items.map((s) => [s.depth, s.parent, s.port, s.iteration]),
    [
      [1, loop, "body", 0],
      [1, loop, "body", 1],
      [1, loop, "body", 2],
    ],
  );
  assert.equal(trace.steps[loop].depth, 0);
  assert.equal(trace.steps.find((s) => s.nodeId === "guard").depth, 0);
});

void test("a failure the Try/Catch caught is handled, the one that stopped the run is not", async () => {
  const { result, trace } = await flowTrace();
  assert.equal(result.failedNodeId, "boom");
  const bad = trace.steps.find((s) => s.nodeId === "bad");
  const boom = trace.steps.find((s) => s.nodeId === "boom");
  assert.equal(bad.status, "failed");
  assert.equal(bad.handled, true);
  assert.equal(boom.status, "failed");
  assert.equal(boom.handled, undefined);
  assert.equal(trace.steps.find((s) => s.nodeId === "note").port, "catch");
});

void test("an If names the branch it took, and only the edges followed are taken", async () => {
  const { trace } = await flowTrace();
  assert.equal(trace.steps.find((s) => s.nodeId === "choose").branch, "then");
  assert.deepEqual(trace.edgesTaken.sort(), [
    "e-body",
    "e-catch",
    "e-each",
    "e-guard",
    "e-t",
    "e-then",
    "e-try",
    "e-yes",
  ]);
});

void test("skipped steps say whether the branch was not taken or the run stopped first", async () => {
  const { trace } = await flowTrace();
  assert.deepEqual(
    trace.skipped.map((s) => [s.nodeId, s.reason]),
    [
      ["after", "stopped"],
      ["no", "branch"],
    ],
  );
});

void test("an exhausted Retry leaves by `exhausted`, not by `main`", async () => {
  const retryGraph = {
    nodes: [
      node("t", "trigger", "manual"),
      flow("r", "retry", { maxAttempts: 2 }),
      node("f", "action", "test.fail"),
      node("x", "action", "log.message"),
    ],
    triggerEdges: [
      edge("e-t", "t", "r"),
      edge("e-body", "r", "f", "body"),
      edge("e-exhausted", "r", "x", "exhausted"),
      edge("e-main", "r", "x"),
    ],
    dataEdges: [],
  };
  const result = await run(retryGraph, "t", {});
  assert.equal(result.status, "ok");
  const trace = traceOf(retryGraph, result.logs, { nodeId: "t", payload: {} });
  const attempts = trace.steps.filter((s) => s.nodeId === "f");
  assert.deepEqual(
    attempts.map((s) => [s.iteration, s.handled]),
    [
      [0, true],
      [1, true],
    ],
  );
  assert.equal(trace.steps.find((s) => s.nodeId === "r").branch, "exhausted");
  assert.deepEqual(trace.edgesTaken.sort(), ["e-body", "e-exhausted", "e-t"]);
});

void test("a Retry whose attempts are not a number runs the default three", async () => {
  for (const maxAttempts of ["abc", {}, "Infinity"]) {
    const retryGraph = {
      nodes: [
        node("t", "trigger", "manual"),
        flow("r", "retry", { maxAttempts }),
        node("f", "action", "test.fail"),
        node("x", "action", "log.message"),
      ],
      triggerEdges: [
        edge("e-t", "t", "r"),
        edge("e-body", "r", "f", "body"),
        edge("e-exhausted", "r", "x", "exhausted"),
      ],
      dataEdges: [],
    };
    const result = await run(retryGraph, "t", {});
    assert.equal(result.status, "ok");
    const trace = traceOf(retryGraph, result.logs, {
      nodeId: "t",
      payload: {},
    });
    assert.deepEqual(
      trace.steps.filter((s) => s.nodeId === "f").map((s) => s.iteration),
      [0, 1, 2],
      `maxAttempts ${JSON.stringify(maxAttempts)}`,
    );
  }
});

void test("against a later version, steps keep the names the run stored and nothing is inferred", async () => {
  const result = await run(graph, "t", { a: 1 });
  const names = { log: { nodeId: "log", label: "Old name", kind: "action" } };
  const outdated = traceOf(
    graph,
    result.logs,
    { nodeId: "t", payload: {} },
    { outdated: true, names },
  );
  assert.equal(outdated.steps[1].name.label, "Old name");
  assert.equal(outdated.steps[2].name.label, "Push to ERP");
  assert.deepEqual(outdated.skipped, []);
  assert.deepEqual(outdated.edgesTaken, []);
  const current = traceOf(graph, result.logs, undefined, { names });
  assert.equal(current.steps[0].name.label, "Say hello");
});

void test("without any graph, a step is still named by the names the run stored", async () => {
  const result = await run(graph, "t", { a: 1 });
  const trace = traceOf(
    undefined,
    result.logs,
    { nodeId: "t", payload: {} },
    { names: stepNamesOf(graph) },
  );
  assert.deepEqual(
    trace.steps.map((s) => s.name.label),
    ["Run by hand", "Say hello", "Push to ERP"],
  );
});

void test("a cut log lists no skipped step and says how much was cut", async () => {
  const result = await run(graph, "t", { a: 1 });
  const trace = traceOf(graph, { ...result.logs, truncated: 12 });
  assert.deepEqual(trace.skipped, []);
  assert.equal(trace.truncated, 12);
});

void test("a step whose end was cut from the log reads as cut, not running", async () => {
  const result = await run(graph, "t", { a: 1 });
  const entries = result.logs.entries.filter(
    (e) => !(e.nodeId === "log" && e.message === "executed"),
  );
  const cut = traceOf(graph, { ...result.logs, entries, truncated: 1 });
  assert.equal(cut.steps.find((s) => s.nodeId === "log").status, "truncated");
  const whole = traceOf(graph, { ...result.logs, entries });
  assert.equal(whole.steps.find((s) => s.nodeId === "log").status, "running");
});

void test("stepNamesOf names every step of the graph by its id", () => {
  const names = stepNamesOf(graph);
  assert.deepEqual(Object.keys(names), ["t", "log", "fail", "after"]);
  assert.equal(names.fail.label, "Push to ERP");
  assert.equal(names.after.typeName, logAction.name);
});

void test("stepDurations adds up every iteration of a step", () => {
  const steps = [
    { nodeId: "a", durationMs: 2 },
    { nodeId: "b", durationMs: null },
    { nodeId: "a", durationMs: 3 },
  ];
  assert.deepEqual(stepDurations(steps), { a: 5, b: null });
});
