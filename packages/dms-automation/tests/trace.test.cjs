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

test("a failed run names the node it failed at", async () => {
  const result = await run(graph, "t", { a: 1 });
  assert.equal(result.status, "failed");
  assert.equal(result.failedNodeId, "fail");
  assert.equal(result.errorMessage, "HTTP 502 Bad Gateway");
});

test("the trace lists the trigger, the steps that ran and the skipped ones", async () => {
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
  assert.equal(typeof failed.durationMs, "number");
  assert.equal(trace.steps[1].name.label, "Say hello");
  assert.deepEqual(
    trace.skipped.map((s) => s.nodeId),
    ["after"],
  );
});

test("a step is named by its label, then by its type", () => {
  assert.equal(stepName(graph, "fail").label, "Push to ERP");
  assert.equal(stepName(graph, "after").typeName, logAction.name);
  assert.deepEqual(stepName(graph, "nope"), { nodeId: "nope" });
});
