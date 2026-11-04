const assert = require("node:assert/strict");
const { test } = require("node:test");

/**
 * The builder refuses a link while it is drawn, with a reason the canvas
 * translates: these tests load the frontend composable that decides it.
 */

require("./helpers/frontend.cjs");

const {
  canConnect,
} = require("../frontend-vue/app/composables/useGraphConnect.ts");

/** @typedef {Parameters<typeof canConnect>[0]} ProcedureGraph */
/** @typedef {Parameters<typeof canConnect>[5]} Connection */
/** @typedef {{ name: string; type?: string }} PortFixture */
/**
 * @typedef {{
 *   label: string;
 *   hasTriggerIn: boolean;
 *   hasMainTriggerOut: boolean;
 *   staticTriggerOuts: string[];
 *   staticDataIns: PortFixture[];
 *   staticDataOuts: PortFixture[];
 * }} NodeKindUI
 */

/** @param {Partial<NodeKindUI>} over */
const ui = (over) => ({
  label: "x",
  hasTriggerIn: true,
  hasMainTriggerOut: true,
  staticTriggerOuts: [],
  staticDataIns: [],
  staticDataOuts: [],
  ...over,
});
const NODE_KINDS = [
  {
    kind: "step",
    meta: {
      continuationPorts: ["main"],
      sidePorts: [],
      ui: ui({
        staticDataIns: [{ name: "in", type: "string" }],
        staticDataOuts: [{ name: "out", type: "string" }],
      }),
    },
  },
  {
    kind: "data",
    meta: {
      continuationPorts: [],
      sidePorts: [],
      ui: ui({
        hasTriggerIn: false,
        hasMainTriggerOut: false,
        staticDataIns: [{ name: "in" }],
        staticDataOuts: [{ name: "out" }, { name: "count", type: "number" }],
      }),
    },
  },
];

/**
 * @param {string} id
 * @param {string} [kind]
 */
const node = (id, kind = "step") => ({
  id,
  kind,
  config: {},
  position: { x: 0, y: 0 },
});

/**
 * @param {ProcedureGraph} graph
 * @param {Connection} connection
 */
function check(graph, connection) {
  return canConnect(graph, NODE_KINDS, [], [], [], connection);
}

/**
 * @param {string} source
 * @param {string} target
 */
const trigger = (source, target) => ({
  source,
  target,
  sourceHandle: "trigger-out-main",
  targetHandle: "trigger-in",
});
/**
 * @param {string} source
 * @param {string} target
 * @param {string} [port]
 * @param {string} [field]
 */
const data = (source, target, port = "out", field = "in") => ({
  source,
  target,
  sourceHandle: `data-out-${port}`,
  targetHandle: `data-in-${field}`,
});

void test("a step can't be linked to itself", () => {
  const graph = { nodes: [node("a")], triggerEdges: [], dataEdges: [] };
  assert.deepEqual(check(graph, trigger("a", "a")), {
    ok: false,
    code: "selfLoop",
  });
  assert.deepEqual(check(graph, data("a", "a")), {
    ok: false,
    code: "selfLoop",
  });
});

void test("a trigger link that would close a loop is refused", () => {
  const graph = {
    nodes: [node("a"), node("b"), node("c")],
    triggerEdges: [
      { id: "ab", from: { node: "a", branch: "main" }, to: { node: "b" } },
      { id: "bc", from: { node: "b", branch: "main" }, to: { node: "c" } },
    ],
    dataEdges: [],
  };
  assert.deepEqual(check(graph, trigger("c", "a")), {
    ok: false,
    code: "cycle",
  });
  assert.deepEqual(check(graph, trigger("a", "c")), { ok: true });
});

void test("a loop of data nodes is refused, a step reading a later output is not", () => {
  const graph = {
    nodes: [node("d1", "data"), node("d2", "data"), node("s"), node("t")],
    triggerEdges: [],
    dataEdges: [
      {
        id: "x",
        from: { node: "d1", port: "out" },
        to: { node: "d2", field: "in" },
      },
      {
        id: "y",
        from: { node: "s", port: "out" },
        to: { node: "t", field: "in" },
      },
    ],
  };
  assert.deepEqual(check(graph, data("d2", "d1")), {
    ok: false,
    code: "cycle",
  });
  assert.deepEqual(check(graph, data("t", "s")), { ok: true });
});

void test("refusals name the reason: port kinds and types", () => {
  const graph = {
    nodes: [node("a"), node("d", "data")],
    triggerEdges: [],
    dataEdges: [],
  };
  assert.deepEqual(
    check(graph, {
      source: "a",
      target: "d",
      sourceHandle: "trigger-out-main",
      targetHandle: "data-in-in",
    }),
    { ok: false, code: "kindMismatch" },
  );
  assert.deepEqual(check(graph, data("d", "a", "count", "in")), {
    ok: false,
    code: "typeMismatch",
    params: { from: "number", to: "string" },
  });
  assert.deepEqual(check(graph, data("a", "d", "nope", "in")), {
    ok: false,
    code: "invalidPorts",
  });
});

void test("a link already in the graph stays valid", () => {
  const graph = {
    nodes: [node("a")],
    triggerEdges: [
      { id: "loop", from: { node: "a", branch: "main" }, to: { node: "a" } },
    ],
    dataEdges: [],
  };
  assert.deepEqual(check(graph, { ...trigger("a", "a"), id: "loop" }), {
    ok: true,
  });
});
