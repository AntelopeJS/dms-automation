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
const { stepDurations, traceOf } = require("../dist/runtime/trace.js");
const { usageByEntry } = require("../dist/routes/library.js");
const { queryOf } = require("../dist/runtime/builtins/triggers/webhook.js");
const { isPropertyBag } = require("../dist/types/guards.js");
const { headersOf } = require("../dist/runtime/builtins/actions/http.js");
const {
  DataCache,
  resolveInputs,
  schemaDefaults,
} = require("../dist/runtime/resolveInputs.js");
const { run } = require("../dist/runtime/executor.js");

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
  const output = dataNode.evaluate(inputs);
  assert.ok(isPropertyBag(output));
  return output.result;
}

/**
 * The inputs `resolveInputs` gives node `n` for one data edge from the port
 * `port` of node `up`, whose output is `output`, into the field `field`.
 * @param {import("../dist/types/dataValue.js").DataRecord} output
 * @param {string} port
 * @param {string} field
 */
function wiredInputs(output, port, field) {
  const cache = new DataCache();
  cache.setOutput("up", output);
  return resolveInputs(
    node("n", "action", "log.message"),
    [{ id: "e", from: { node: "up", port }, to: { node: "n", field } }],
    cache,
  );
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

  void test(`a data edge from a port named ${name} wires only an output the node owns`, () => {
    assert.deepEqual(Object.keys(wiredInputs({ a: 1 }, name, "f")), []);
  });

  void test(`a data edge into a field named ${name} sets that input as its own`, () => {
    const inputs = wiredInputs({ a: { b: 1 } }, "a", name);
    assert.deepEqual(Object.keys(inputs), [name]);
    assert.deepEqual(Object.getOwnPropertyDescriptor(inputs, name)?.value, {
      b: 1,
    });
  });

  void test(`a schema default named ${name} is kept as its own`, () => {
    const defaults = schemaDefaults({
      type: "object",
      properties: { [name]: { type: "number", default: 1 } },
    });
    assert.deepEqual(Object.keys(defaults), [name]);
    assert.equal(Object.getOwnPropertyDescriptor(defaults, name)?.value, 1);
  });

  void test(`a data node output named ${name} is logged as its own`, async () => {
    const typeId = `test.outputs-${name}`;
    registry.addDataNode(typeId, {
      id: typeId,
      name: "Outputs",
      evaluate: () => Object.fromEntries([[name, 1]]),
    });
    const result = await run(
      {
        nodes: [
          node("t", "trigger", "manual"),
          node("d", "data", typeId),
          node("log", "action", "log.message"),
        ],
        triggerEdges: [
          { id: "t-log", from: { node: "t" }, to: { node: "log" } },
        ],
        dataEdges: [
          {
            id: "d-log",
            from: { node: "d", port: name },
            to: { node: "log", field: "value" },
          },
        ],
      },
      "t",
      {},
    );
    const evaluated = result.logs.entries.find(
      (entry) => entry.message === `evaluated ${typeId}`,
    );
    const value = evaluated?.value;
    assert.ok(isPropertyBag(value));
    const { output } = value;
    assert.ok(isPropertyBag(output));
    assert.deepEqual(Object.keys(output), [name]);
    assert.deepEqual(Object.getOwnPropertyDescriptor(output, name)?.value, {
      type: "number",
      value: 1,
    });
  });
}

registry.addDataNode("test.gives-nothing", {
  id: "test.gives-nothing",
  name: "Gives nothing",
  evaluate: () => ({}),
});
registry.addDataNode("test.fails", {
  id: "test.fails",
  name: "Fails",
  evaluate: () => {
    throw new Error("failed");
  },
});

/**
 * The run of a manual trigger into a `log.message` node whose config is
 * `config` and whose data edges are `dataEdges`, after the nodes `extra`.
 * @param {import("../dist/types/dataValue.js").DataRecord} config
 * @param {import("../dist/types/graph.js").GraphNode[]} [extra]
 * @param {import("../dist/types/graph.js").DataEdge[]} [dataEdges]
 */
const runLog = (config, extra = [], dataEdges = []) =>
  run(
    {
      nodes: [
        node("t", "trigger", "manual"),
        ...extra,
        node("log", "action", "log.message", config),
      ],
      triggerEdges: [{ id: "t-log", from: { node: "t" }, to: { node: "log" } }],
      dataEdges,
    },
    "t",
    {},
  );

for (const name of INHERITED_NAMES) {
  void test(`a step ${name} the run's kept names miss is named by its id`, () => {
    const entry = (
      /** @type {string} */ message,
      /** @type {number} */ ts,
    ) => ({
      ts,
      level: "info",
      source: "executor",
      fireId: "f",
      nodeId: name,
      nodeKind: "action",
      message,
    });
    const trace = traceOf(
      undefined,
      {
        entries: [entry("executing", 1), entry("executed", 2)],
        fires: [{ id: "f", sourceNodeId: name }],
      },
      undefined,
      { outdated: true, names: {} },
    );
    assert.deepEqual(trace.steps[0]?.name, { nodeId: name, kind: "action" });
  });

  void test(`a step failing with its field ${name} unfed names the source that gave nothing`, async () => {
    const result = await runLog(
      { message: "m" },
      [
        node("src", "data", "test.gives-nothing"),
        node("d", "data", "test.fails"),
      ],
      [
        {
          id: "src-d",
          from: { node: "src", port: "out" },
          to: { node: "d", field: name },
        },
        {
          id: "d-log",
          from: { node: "d", port: "x" },
          to: { node: "log", field: "value" },
        },
      ],
    );
    assert.match(
      JSON.stringify(result.logs.entries),
      new RegExp(
        `failed\\. ${name} comes from test\\.gives-nothing \\(out\\), which gave no value`,
      ),
    );
  });

  void test(`log.message at the level ${name} runs`, async () => {
    const result = await runLog({ message: "m", level: name });
    assert.deepEqual(
      result.logs.entries.filter((entry) => entry.level === "error"),
      [],
    );
  });
}
