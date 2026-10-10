const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../dist/runtime/builtins");
const {
  graphIssues,
  hasBlockingIssue,
  hasTrigger,
} = require("../dist/runtime/graphIssues.js");

const node = (id, kind, typeId) => ({
  id,
  kind,
  typeId,
  config: {},
  position: { x: 0, y: 0 },
});

test("a step nothing triggers is a warning on its node", () => {
  const graph = {
    nodes: [
      node("t", "trigger", "manual"),
      node("a", "action", "log.message"),
      node("b", "action", "log.message"),
    ],
    triggerEdges: [{ id: "e", from: { node: "t" }, to: { node: "a" } }],
    dataEdges: [],
  };
  const issues = graphIssues(graph);
  assert.deepEqual(issues, [
    {
      severity: "warning",
      message: "nothing triggers this step, it can never run",
      nodeId: "b",
    },
  ]);
  assert.equal(hasBlockingIssue(issues), false);
});

test("validator errors are blocking and point at the node they name", () => {
  const graph = {
    nodes: [node("t", "trigger", "manual"), node("a", "action", "log.message")],
    triggerEdges: [
      { id: "e1", from: { node: "t" }, to: { node: "a" } },
      { id: "e2", from: { node: "a" }, to: { node: "t" } },
    ],
    dataEdges: [
      {
        id: "d1",
        from: { node: "t", port: "x" },
        to: { node: "a", field: "message" },
      },
      {
        id: "d2",
        from: { node: "t", port: "y" },
        to: { node: "a", field: "message" },
      },
    ],
  };
  const issues = graphIssues(graph);
  assert.equal(hasBlockingIssue(issues), true);
  const fanIn = issues.find((i) => i.message.includes("more than one source"));
  assert.equal(fanIn.nodeId, "a");
  assert.ok(issues.some((i) => i.nodeId === "t"));
});

test("a graph has a trigger when any node is one", () => {
  assert.equal(
    hasTrigger({
      nodes: [node("t", "trigger", "manual")],
      triggerEdges: [],
      dataEdges: [],
    }),
    true,
  );
  assert.equal(
    hasTrigger({ nodes: [], triggerEdges: [], dataEdges: [] }),
    false,
  );
});
