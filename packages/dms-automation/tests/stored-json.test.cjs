const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Schema } = require("@antelopejs/interface-database");

/** @type {Array<{ _id: string, name: string, graph: string }>} */
let storedProcedures = [];
const procedureTable = {
  count: () => ({ run: async () => storedProcedures.length }),
  orderBy: () => ({
    run: async () => storedProcedures,
    slice: (/** @type {number} */ offset, /** @type {number} */ count) => ({
      run: async () => storedProcedures.slice(offset, offset + count),
    }),
  }),
};
Schema.get = () => ({ instance: () => ({ table: () => procedureTable }) });

const {
  AutomationTemplateModel,
} = require("../dist/db/models/automation_template.model.js");
const { armErrorOf } = require("../dist/runtime/armErrors.js");
const { parseGraph } = require("../dist/types/graph.js");

const GRAPH = {
  nodes: [
    {
      id: "t",
      kind: "trigger",
      typeId: "manual",
      config: {},
      position: { x: 0, y: 0 },
      ui: { kept: true },
    },
  ],
  triggerEdges: [
    { id: "e", from: { node: "t" }, to: { node: "a", branch: "in" } },
  ],
  dataEdges: [
    { id: "d", from: { node: "t", port: "p" }, to: { node: "a", field: "f" } },
  ],
};

void test("a stored graph reads back as written, fields it does not type included", () => {
  assert.deepEqual(parseGraph(JSON.stringify(GRAPH)), GRAPH);
});

void test("a stored graph that is JSON but not shaped as a graph is refused as unreadable", () => {
  for (const broken of [
    { ...GRAPH, dataEdges: undefined },
    { ...GRAPH, nodes: [{ ...GRAPH.nodes[0], position: { x: "0", y: 0 } }] },
    { ...GRAPH, nodes: [{ ...GRAPH.nodes[0], label: 5 }] },
    {
      ...GRAPH,
      triggerEdges: [{ id: "e", from: { node: 1 }, to: { node: "a" } }],
    },
    { ...GRAPH, nodes: [{ ...GRAPH.nodes[0], config: [] }] },
    { ...GRAPH, nodes: [{ ...GRAPH.nodes[0], typeId: 3 }] },
    {
      ...GRAPH,
      dataEdges: [
        { id: "d", from: { node: "t" }, to: { node: "a", field: "f" } },
      ],
    },
    [],
  ]) {
    assert.throws(() => parseGraph(JSON.stringify(broken)), SyntaxError);
  }
});

const problem = {
  code: "missingField",
  params: { field: "url", n: 1 },
  message: "URL is empty",
};
/** @param {string} armErrors */
const procedureWith = (armErrors) => ({ enabled: true, armErrors });

void test("a stored arm error reads back as written", () => {
  assert.deepEqual(
    armErrorOf(procedureWith(JSON.stringify({ t: problem }))),
    problem,
  );
});

void test("stored arm errors not shaped as arm errors read as none", () => {
  for (const broken of [
    { t: { ...problem, code: 5 } },
    { t: { ...problem, params: { field: true } } },
    { t: "missingField" },
    [problem],
  ]) {
    assert.equal(armErrorOf(procedureWith(JSON.stringify(broken))), undefined);
  }
});

/** @param {string} ports */
async function templatePorts(ports) {
  const stored = {
    get: async () => ({
      _id: "x",
      name: "n",
      ports,
      subgraph: JSON.stringify(GRAPH),
    }),
  };
  const row = await AutomationTemplateModel.prototype.getById.call(stored, "x");
  assert.ok(row);
  return row.ports;
}

void test("stored template ports read back as written", async () => {
  const ports = [
    { name: "in", kind: "data", direction: "in", schema: { type: "string" } },
    { name: "go", kind: "trigger", direction: "out" },
  ];
  assert.deepEqual(await templatePorts(JSON.stringify(ports)), ports);
});

void test("stored template ports not shaped as ports read as none", async () => {
  for (const broken of [
    [{ name: "in", kind: "data", direction: "sideways" }],
    [{ name: 1, kind: "data", direction: "in" }],
    [{ name: "in", kind: "data", direction: "in", schema: "string" }],
    { name: "in", kind: "data", direction: "in" },
  ]) {
    assert.deepEqual(await templatePorts(JSON.stringify(broken)), []);
  }
});

void test("a procedure whose stored graph cannot be read is left out of the list, its pages and its total", async () => {
  const { ProceduresController } = require("../dist/routes/procedures.js");
  const numericLabelGraph = JSON.stringify({
    ...GRAPH,
    nodes: [{ ...GRAPH.nodes[0], label: 5 }],
  });
  storedProcedures = [
    { _id: "text", name: "text", graph: "{" },
    { _id: "first", name: "first", graph: JSON.stringify(GRAPH) },
    { _id: "label", name: "label", graph: numericLabelGraph },
    { _id: "second", name: "second", graph: JSON.stringify(GRAPH) },
  ];
  const pageOf = async (/** @type {string} */ page) => {
    const listed = await ProceduresController.prototype.list.call(
      {},
      {},
      page,
      "1",
    );
    return {
      ids: listed.results.map((p) => [p._id, p.graph]),
      total: listed.total,
    };
  };
  assert.deepEqual(await pageOf("0"), { ids: [["first", GRAPH]], total: 2 });
  assert.deepEqual(await pageOf("1"), { ids: [["second", GRAPH]], total: 2 });
  assert.deepEqual(await pageOf("2"), { ids: [], total: 2 });
});
