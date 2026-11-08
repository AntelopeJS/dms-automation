const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  builtinDataNodes,
  builtinTriggers,
} = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { run } = require("../dist/runtime/executor.js");

/** @typedef {import("../dist/types/dataValue.js").DataValue} DataValue */
/** @typedef {import("../dist/types/dataValue.js").DataRecord} DataRecord */
/** @typedef {import("../dist/types/graph.js").GraphNode} GraphNode */
/** @typedef {import("../dist/types/graph.js").DataEdge} DataEdge */
/** @typedef {import("../dist/types/graph.js").TriggerEdge} TriggerEdge */

for (const t of builtinTriggers) registry.addTrigger(t.id, t);
for (const d of builtinDataNodes) registry.addDataNode(d.id, d);

/** @type {DataValue[]} */
let recorded = [];
registry.addAction("test.record", {
  id: "test.record",
  name: "Record",
  execute: async (/** @type {DataRecord} */ inputs) => {
    recorded.push(inputs.value);
  },
});

/**
 * @param {string} id
 * @param {string} kind
 * @param {string} [typeId]
 * @param {DataRecord} [config]
 * @returns {GraphNode}
 */
function node(id, kind, typeId, config = {}) {
  const n = { id, kind, config, position: { x: 0, y: 0 } };
  if (typeId) n.typeId = typeId;
  return n;
}

/**
 * @param {string} from
 * @param {string} to
 * @param {string} [branch]
 * @returns {TriggerEdge}
 */
function edge(from, to, branch) {
  /** @type {TriggerEdge} */
  const e = { id: `${from}-${to}`, from: { node: from }, to: { node: to } };
  if (branch) e.from.branch = branch;
  return e;
}

/**
 * @param {string} from
 * @param {string} port
 * @param {string} to
 * @param {string} field
 * @returns {DataEdge}
 */
function wire(from, port, to, field) {
  return {
    id: `${from}.${port}-${to}.${field}`,
    from: { node: from, port },
    to: { node: to, field },
  };
}

void test("a data node wired from a loop's value follows each item", async () => {
  recorded = [];
  const result = await run(
    {
      nodes: [
        node("t", "trigger", "manual"),
        node("e", "foreach", undefined, { items: [1, 5, 9] }),
        node("m", "data", "math.add", { b: 100 }),
        node("l", "action", "test.record"),
      ],
      triggerEdges: [edge("t", "e"), edge("e", "l", "body")],
      dataEdges: [
        wire("e", "value", "m", "a"),
        wire("m", "result", "l", "value"),
      ],
    },
    "t",
    {},
  );
  assert.equal(result.status, "ok");
  assert.deepEqual(recorded, [101, 105, 109]);
});

void test("an If fed by a data node on the loop's value picks the branch of each item", async () => {
  recorded = [];
  const result = await run(
    {
      nodes: [
        node("t", "trigger", "manual"),
        node("e", "foreach", undefined, { items: [1, 5, 9] }),
        node("gt", "data", "compare.gt", { b: 3 }),
        node("if", "if"),
        node("yes", "action", "test.record", { value: "then" }),
        node("no", "action", "test.record", { value: "else" }),
      ],
      triggerEdges: [
        edge("t", "e"),
        edge("e", "if", "body"),
        edge("if", "yes", "then"),
        edge("if", "no", "else"),
      ],
      dataEdges: [
        wire("e", "value", "gt", "a"),
        wire("gt", "result", "if", "cond"),
      ],
    },
    "t",
    {},
  );
  assert.equal(result.status, "ok");
  assert.deepEqual(recorded, ["else", "then", "then"]);
});

void test("a data node two steps from the loop's value follows each item", async () => {
  recorded = [];
  const result = await run(
    {
      nodes: [
        node("t", "trigger", "manual"),
        node("e", "foreach", undefined, { items: [1, 5, 9] }),
        node("m", "data", "math.add", { b: 100 }),
        node("n", "data", "math.add", { b: 1000 }),
        node("l", "action", "test.record"),
      ],
      triggerEdges: [edge("t", "e"), edge("e", "l", "body")],
      dataEdges: [
        wire("e", "value", "m", "a"),
        wire("m", "result", "n", "a"),
        wire("n", "result", "l", "value"),
      ],
    },
    "t",
    {},
  );
  assert.equal(result.status, "ok");
  assert.deepEqual(recorded, [1101, 1105, 1109]);
});
