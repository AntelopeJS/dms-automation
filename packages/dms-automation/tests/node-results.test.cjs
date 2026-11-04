const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  builtinActions,
  builtinDataNodes,
  builtinTriggers,
} = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { run } = require("../dist/runtime/executor.js");

for (const t of builtinTriggers) registry.addTrigger(t.id, t);
for (const a of builtinActions) registry.addAction(a.id, a);
for (const d of builtinDataNodes) registry.addDataNode(d.id, d);

registry.addDataNode("test.text", {
  id: "test.text",
  name: "Text",
  evaluate: () => "abc",
});
registry.addDataNode("test.nothing", {
  id: "test.nothing",
  name: "Nothing",
  evaluate: () => null,
});
registry.addDataNode("test.list", {
  id: "test.list",
  name: "List",
  evaluate: () => [1, 2],
});
registry.addAction("test.says-ok", {
  id: "test.says-ok",
  name: "Says ok",
  execute: async () => "ok",
});
registry.addAction("test.says-nothing", {
  id: "test.says-nothing",
  name: "Says nothing",
  execute: async () => undefined,
});

/**
 * @param {string} id
 * @param {string} kind
 * @param {string} [typeId]
 * @returns {import("../dist/types/graph.js").GraphNode}
 */
function node(id, kind, typeId) {
  const n = { id, kind, config: {}, position: { x: 0, y: 0 } };
  if (typeId) n.typeId = typeId;
  return n;
}

/**
 * @param {string} from
 * @param {string} to
 * @returns {import("../dist/types/graph.js").TriggerEdge}
 */
function edge(from, to) {
  return { id: `${from}-${to}`, from: { node: from }, to: { node: to } };
}

for (const typeId of ["test.text", "test.nothing", "test.list"]) {
  void test(`a data node type that evaluates to something other than an object fails the step that reads it (${typeId})`, async () => {
    const result = await run(
      {
        nodes: [
          node("t", "trigger", "manual"),
          node("d", "data", typeId),
          node("log", "action", "log.message"),
        ],
        triggerEdges: [edge("t", "log")],
        dataEdges: [
          {
            id: "d-log",
            from: { node: "d", port: "result" },
            to: { node: "log", field: "value" },
          },
        ],
      },
      "t",
      {},
    );
    assert.equal(result.status, "failed");
    assert.equal(result.failedNodeId, "log");
    assert.match(
      result.errorMessage,
      new RegExp(`data node type "${typeId}" must evaluate to an object`),
    );
  });
}

/**
 * @param {string} typeId
 * @returns {Promise<import("../dist/runtime/executionResult.js").ExecutionResult>}
 */
function runAction(typeId) {
  return run(
    {
      nodes: [node("t", "trigger", "manual"), node("a", "action", typeId)],
      triggerEdges: [edge("t", "a")],
      dataEdges: [],
    },
    "t",
    {},
  );
}

void test("an action type that resolves with something other than an object or nothing fails its step", async () => {
  const result = await runAction("test.says-ok");
  assert.equal(result.status, "failed");
  assert.equal(result.failedNodeId, "a");
  assert.match(
    result.errorMessage,
    /action type "test\.says-ok" must resolve with an object or nothing/,
  );
});

void test("an action type that resolves with nothing still succeeds", async () => {
  const result = await runAction("test.says-nothing");
  assert.equal(result.status, "ok");
});
