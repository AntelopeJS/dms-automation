const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  builtinActions,
  builtinDataNodes,
  builtinTriggers,
} = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { graphIssues } = require("../dist/runtime/graphIssues.js");
const { stepNamesOf } = require("../dist/runtime/describe.js");
const { stepDurations } = require("../dist/runtime/trace.js");
const { usageByEntry } = require("../dist/routes/library.js");
const { queryOf } = require("../dist/runtime/builtins/triggers/webhook.js");
const { isPropertyBag } = require("../dist/types/guards.js");
const { headersOf } = require("../dist/runtime/builtins/actions/http.js");

for (const t of builtinTriggers) registry.addTrigger(t.id, t);
for (const a of builtinActions) registry.addAction(a.id, a);
for (const d of builtinDataNodes) registry.addDataNode(d.id, d);

/**
 * Names a plain object answers for without owning them, and `__proto__`,
 * which an object literal turns into a prototype.
 */
const INHERITED_NAMES = [
  "constructor",
  "toString",
  "hasOwnProperty",
  "__proto__",
];

/**
 * @param {string} id
 * @param {string} kind
 * @param {string} [typeId]
 * @param {import("../dist/types/dataValue.js").DataRecord} [config]
 * @returns {import("../dist/types/graph.js").GraphNode}
 */
const node = (id, kind, typeId, config = {}) => ({
  id,
  kind,
  typeId,
  config,
  position: { x: 0, y: 0 },
});

/**
 * The `result` port of a data node evaluated on `inputs`.
 * @param {string} id
 * @param {Record<string, unknown>} inputs
 * @returns {Promise<unknown>}
 */
async function evaluateResult(id, inputs) {
  const dataNode = registry.getDataNode(id);
  assert.ok(dataNode);
  const output = await dataNode.evaluate(inputs);
  assert.ok(isPropertyBag(output));
  return output.result;
}

/** @param {import("../dist/types/graph.js").GraphNode[]} nodes */
const graphOf = (nodes) => ({ nodes, triggerEdges: [], dataEdges: [] });

for (const name of INHERITED_NAMES) {
  void test(`a step named ${name} adds its own duration`, () => {
    const durations = stepDurations([
      { nodeId: name, durationMs: 5 },
      { nodeId: name, durationMs: 7 },
    ]);
    assert.equal(Object.keys(durations).length, 1);
    assert.equal(Object.getOwnPropertyDescriptor(durations, name)?.value, 12);
  });

  void test(`a node with the id ${name} keeps its step name`, () => {
    const names = stepNamesOf(graphOf([node(name, "action", "log.message")]));
    assert.deepEqual(Object.keys(names), [name]);
    assert.equal(
      Object.getOwnPropertyDescriptor(names, name)?.value?.nodeId,
      name,
    );
  });

  void test(`a trigger of type ${name} is reported as an issue, not crashed on`, () => {
    const issues = graphIssues(
      graphOf([node("t", "trigger", name, { cron: "bad" })]),
    );
    for (const issue of issues) {
      assert.match(issue.code, /\w/);
      assert.match(issue.message, /\w/);
    }
    assert.ok(issues.length > 0);
  });

  void test(`object.get reads no inherited ${name}`, async () => {
    assert.equal(
      await evaluateResult("object.get", { obj: { a: 1 }, path: name }),
      null,
    );
  });

  void test(`object.set writes ${name} as its own key, top level and nested`, async () => {
    const top = await evaluateResult("object.set", {
      obj: {},
      path: name,
      value: 1,
    });
    assert.ok(isPropertyBag(top));
    assert.deepEqual(Object.keys(top), [name]);
    assert.equal(Object.getOwnPropertyDescriptor(top, name)?.value, 1);
    const nested = await evaluateResult("object.set", {
      obj: { a: {} },
      path: `a.${name}`,
      value: 2,
    });
    assert.ok(isPropertyBag(nested));
    assert.ok(isPropertyBag(nested.a));
    assert.deepEqual(Object.keys(nested.a), [name]);
    assert.equal(Object.getOwnPropertyDescriptor(nested.a, name)?.value, 2);
  });

  void test(`a webhook query parameter named ${name} is kept as its own`, () => {
    const query = queryOf(new URL(`http://localhost/hook?${name}=x`));
    assert.deepEqual(Object.keys(query), [name]);
    assert.equal(Object.getOwnPropertyDescriptor(query, name)?.value, "x");
  });

  void test(`a response header named ${name} is kept as its own`, () => {
    const headers = headersOf(
      new Response(null, { headers: new Headers([[name, "x"]]) }),
    );
    assert.equal(
      Object.getOwnPropertyDescriptor(headers, name.toLowerCase())?.value,
      "x",
    );
  });

  void test(`a catalog entry named ${name} lists its usage`, () => {
    const usage = usageByEntry(
      [
        {
          procedure: { _id: "p", name: "P", enabled: true },
          graph: graphOf([node("n", "action", name)]),
          triggers: [],
        },
      ],
      new Map(),
      new Map(),
      (placed) => placed.typeId,
    );
    assert.equal(
      Object.getOwnPropertyDescriptor(usage, name)?.value?.length,
      1,
    );
  });
}
