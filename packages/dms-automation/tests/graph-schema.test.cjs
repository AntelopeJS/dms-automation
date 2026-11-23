const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  builtinActions,
  builtinDataNodes,
  builtinTriggers,
} = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { procedureGraphSchema } = require("../dist/routes/graphSchema.js");

for (const t of builtinTriggers) registry.addTrigger(t.id, t);
for (const a of builtinActions) registry.addAction(a.id, a);
for (const d of builtinDataNodes) registry.addDataNode(d.id, d);

/** @param {Record<string, unknown>} config */
const graphWith = (config) => ({
  nodes: [
    {
      id: "a",
      kind: "action",
      typeId: "log.message",
      config,
      position: { x: 0, y: 0 },
    },
  ],
  triggerEdges: [],
  dataEdges: [],
});

void test("a node config keeps the values JSON cannot hold that it holds today", () => {
  const when = new Date(0);
  const parsed = procedureGraphSchema.safeParse(
    graphWith({ when, count: Number.NaN, nested: { unset: undefined } }),
  );
  assert.ok(parsed.success);
  assert.equal(parsed.data.nodes[0].config.when, when);
  assert.ok(Number.isNaN(parsed.data.nodes[0].config.count));
});

void test("a node config holding a function is refused", () => {
  const parsed = procedureGraphSchema.safeParse(graphWith({ run: () => 1 }));
  assert.equal(parsed.success, false);
});

void test("an import missing its name or graph is not a procedure, which an importErrorOf reading zod 3's `received` calls an invalid graph", () => {
  const {
    exportedSchema,
    importErrorOf,
  } = require("../dist/routes/procedureSchemas.js");
  const graph = { nodes: [], triggerEdges: [], dataEdges: [] };
  const node = { id: "a", kind: "wat", config: {}, position: { x: 0, y: 0 } };
  /** @param {unknown} raw */
  const errorOf = (raw) =>
    importErrorOf(raw, exportedSchema.safeParse(raw).error.issues);
  const IMPORT = "$dms_automation.importProcedure";
  assert.deepEqual(
    [
      errorOf({ graph }),
      errorOf({ name: "x" }),
      errorOf({ name: "x", graph: { ...graph, nodes: [node] } }),
      errorOf({ name: "x", graph: { nodes: 3 } }),
      errorOf([]),
    ],
    [
      `${IMPORT}.notProcedure`,
      `${IMPORT}.notProcedure`,
      `${IMPORT}.unknownKind`,
      `${IMPORT}.invalidGraph`,
      `${IMPORT}.invalidGraph`,
    ],
  );
});
