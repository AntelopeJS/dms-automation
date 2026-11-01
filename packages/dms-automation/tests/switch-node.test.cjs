const assert = require("node:assert/strict");
const { test } = require("node:test");
const { builtinActions, builtinTriggers } = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { run } = require("../dist/runtime/executor.js");

/** @typedef {import("../dist/types/dataValue.js").DataValue} DataValue */
/** @typedef {import("../dist/types/graph.js").GraphNode} GraphNode */

for (const t of builtinTriggers) registry.addTrigger(t.id, t);
for (const a of builtinActions) registry.addAction(a.id, a);

/**
 * The branch a Switch takes for `value` among `cases`, each branch wired to
 * its own Log.
 * @param {DataValue} value
 * @param {string[]} cases
 * @returns {Promise<string | undefined>}
 */
async function switchBranch(value, cases) {
  const branches = [...cases, "default"];
  /** @type {GraphNode[]} */
  const logs = branches.map((_, i) => ({
    id: `b${i}`,
    kind: "action",
    typeId: "log.message",
    config: {},
    position: { x: 0, y: 0 },
  }));
  const result = await run(
    {
      nodes: [
        {
          id: "t",
          kind: "trigger",
          typeId: "manual",
          config: {},
          position: { x: 0, y: 0 },
        },
        {
          id: "sw",
          kind: "switch",
          config: { cases, value },
          position: { x: 0, y: 0 },
        },
        ...logs,
      ],
      triggerEdges: [
        { id: "t-sw", from: { node: "t" }, to: { node: "sw" } },
        ...branches.map((branch, i) => ({
          id: `sw-b${i}`,
          from: { node: "sw", branch },
          to: { node: `b${i}` },
        })),
      ],
      dataEdges: [],
    },
    "t",
    {},
  );
  assert.equal(result.status, "ok");
  const ran = new Set(
    result.logs.entries
      .filter((e) => e.message === "executed")
      .map((e) => e.nodeId),
  );
  const taken = branches.filter((_, i) => ran.has(`b${i}`));
  assert.equal(taken.length, 1);
  return taken[0];
}

void test("Switch matches strings, numbers and booleans by their text", async () => {
  assert.equal(await switchBranch("a", ["a", "b"]), "a");
  assert.equal(await switchBranch("c", ["a", "b"]), "default");
  assert.equal(await switchBranch(1, ["1", "2"]), "1");
  assert.equal(await switchBranch(1.5, ["1.5"]), "1.5");
  assert.equal(await switchBranch(2, ["2.0"]), "default");
  assert.equal(await switchBranch(true, ["true", "false"]), "true");
  assert.equal(await switchBranch(false, ["true", "false"]), "false");
});

void test("Switch matches objects and arrays by their JSON text", async () => {
  assert.equal(
    await switchBranch({ a: 1 }, ['{"a":1}', "[object Object]"]),
    '{"a":1}',
  );
  assert.equal(await switchBranch([1, "x"], ['[1,"x"]', "1,x"]), '[1,"x"]');
  assert.equal(await switchBranch([[1, 2]], ["[[1,2]]", "1,2"]), "[[1,2]]");
  assert.equal(await switchBranch({ a: 1 }, ["[object Object]"]), "default");
});
