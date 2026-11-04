const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");
const { Schema } = require("@antelopejs/interface-database");

Schema.get = () => ({ instance: () => ({ table: () => ({}) }) });

const {
  AutomationTemplateModel,
} = require("../dist/db/models/automation_template.model.js");
const { ProcedureModel } = require("../dist/db/models/procedure.model.js");
const { forkTemplateInstances } = require("../dist/runtime/resolveSubgraph.js");
const { subscriptions } = require("../dist/runtime/subscriptions.js");
const { TemplatesController } = require("../dist/routes/templates.js");
const { isGroupNode, parseGraph } = require("../dist/types/graph.js");
const { isPropertyBag, isString } = require("../dist/types/guards.js");

/** @typedef {import("../dist/types/graph.js").ProcedureGraph} ProcedureGraph */
/** @typedef {import("../dist/types/graph.js").GraphNode} GraphNode */
/** @typedef {import("../dist/types/graph.js").GroupNode} GroupNode */
/** @typedef {{ _id: string, name: string, subgraph: ProcedureGraph }} TemplateFixture */
/** @typedef {{ _id: string, graph: string }} ProcedureFixture */

/** @type {Map<string, TemplateFixture>} */
const templates = new Map();
/** @type {Map<string, ProcedureFixture>} */
const procedures = new Map();

Object.assign(AutomationTemplateModel.prototype, {
  listAll: async () => [...templates.values()].map((t) => structuredClone(t)),
  /** @param {string} id */
  getById: async (id) => structuredClone(templates.get(id)),
  /**
   * @param {string} id
   * @param {Partial<TemplateFixture>} patch
   */
  updateById: async (id, patch) => {
    templates.set(id, { ...templates.get(id), ...patch });
    return structuredClone(templates.get(id));
  },
  /** @param {string} id */
  deleteById: async (id) => {
    templates.delete(id);
  },
});
Object.assign(ProcedureModel.prototype, {
  getAll: async () => [...procedures.values()].map((p) => ({ ...p })),
});

/**
 * Stands in for the runtime's fork of one procedure usage (the runtime's forkUsage):
 * the node at `groupPath` becomes a local group. `brokenFork` makes it miss.
 */
let brokenFork = false;
subscriptions.forkUsageToLocal = async (
  procedureId,
  nodeId,
  groupPath = [],
) => {
  if (brokenFork) return;
  const p = procedures.get(procedureId);
  assert.ok(p);
  const graph = parseGraph(p.graph);
  let level = graph;
  for (const id of groupPath) {
    const holder = level.nodes.find((n) => n.id === id);
    assert.ok(holder && isGroupNode(holder) && holder.subgraph);
    level = holder.subgraph;
  }
  const node = level.nodes.find((n) => n.id === nodeId);
  assert.ok(node && isGroupNode(node) && node.templateId);
  const template = templates.get(node.templateId);
  assert.ok(template);
  forkTemplateInstances(
    { nodes: [node], triggerEdges: [], dataEdges: [] },
    template,
  );
  procedures.set(procedureId, { ...p, graph: JSON.stringify(graph) });
};
for (const hook of [
  "onTemplateChange",
  "onTemplateDelete",
  "onProcedureChange",
]) {
  subscriptions[hook] = async () => {};
}

/**
 * @param {string} id
 * @param {string} kind
 * @param {Partial<GroupNode>} [extra]
 * @returns {GraphNode}
 */
const node = (id, kind, extra = {}) => ({
  id,
  kind,
  config: {},
  position: { x: 0, y: 0 },
  ...extra,
});
/**
 * @param {...GraphNode} nodes
 * @returns {ProcedureGraph}
 */
const graph = (...nodes) => ({ nodes, triggerEdges: [], dataEdges: [] });
/**
 * @param {string} id
 * @param {string} templateId
 */
const instance = (id, templateId) =>
  node(id, "group", { templateId, ports: [] });
/**
 * @param {string} id
 * @param {ProcedureGraph} subgraph
 */
const group = (id, subgraph) => node(id, "group", { ports: [], subgraph });

beforeEach(() => {
  brokenFork = false;
  templates.clear();
  procedures.clear();
  templates.set("A", {
    _id: "A",
    name: "Notify",
    subgraph: graph(node("log", "action")),
  });
  templates.set("B", {
    _id: "B",
    name: "Wrapper",
    subgraph: graph(instance("a-in-b", "A")),
  });
  procedures.set("P", {
    _id: "P",
    graph: JSON.stringify(
      graph(
        instance("root", "A"),
        group("g1", graph(group("g2", graph(instance("deep", "A"))))),
      ),
    ),
  });
});

/**
 * Every group of a graph that still places template `id`.
 * @param {ProcedureGraph} g
 * @param {string} id
 * @returns {GroupNode[]}
 */
function instancesOf(g, id) {
  return g.nodes.flatMap((n) =>
    isGroupNode(n)
      ? [
          ...(n.templateId === id ? [n] : []),
          ...(n.subgraph ? instancesOf(n.subgraph, id) : []),
        ]
      : [],
  );
}

/**
 * @param {ProcedureGraph} g
 * @param {number} index
 * @returns {GroupNode}
 */
function groupAt(g, index) {
  const n = g.nodes[index];
  assert.ok(isGroupNode(n));
  return n;
}

/**
 * The local subgraph of the group at `index`.
 * @param {ProcedureGraph} g
 * @param {number} index
 * @returns {ProcedureGraph}
 */
function innerOf(g, index) {
  const { subgraph } = groupAt(g, index);
  assert.ok(subgraph);
  return subgraph;
}

/**
 * The JSON body of a thrown HTTPResult, once its status matches.
 * @param {unknown} e
 * @param {number} status
 * @returns {Record<string, unknown>}
 */
function thrownJson(e, status) {
  assert.ok(isPropertyBag(e));
  assert.equal(e.status, status);
  assert.ok(isString(e.body));
  /** @type {unknown} */
  const body = JSON.parse(e.body);
  assert.ok(isPropertyBag(body));
  return body;
}

/**
 * @param {string} id
 * @param {string} [force]
 */
const remove = (id, force) => new TemplatesController().remove({}, id, force);

void test("deleting forks every usage, nested and in other templates, then removes it", async () => {
  const result = await remove("A", "1");
  assert.deepEqual(result, { _id: "A", forked: 3 });
  assert.equal(templates.has("A"), false);

  const stored = procedures.get("P");
  assert.ok(stored);
  const p = parseGraph(stored.graph);
  assert.deepEqual(instancesOf(p, "A"), []);
  const deep = groupAt(innerOf(innerOf(p, 1), 0), 0);
  assert.equal(deep.label, "Notify");
  assert.deepEqual(deep.subgraph, graph(node("log", "action")));

  const template = templates.get("B");
  assert.ok(template);
  const b = template.subgraph;
  assert.deepEqual(instancesOf(b, "A"), []);
  assert.equal(b.nodes[0].label, "Notify");
});

void test("without force a used template is refused and listed", async () => {
  await assert.rejects(remove("A"), (e) => {
    const body = thrownJson(e, 409);
    assert.equal(body.code, "in-use");
    assert.ok(Array.isArray(body.procedures));
    assert.equal(body.procedures.length, 2);
    assert.deepEqual(body.procedures[1].groupPath, ["g1", "g2"]);
    assert.ok(Array.isArray(body.templates));
    assert.equal(body.templates[0].templateId, "B");
    return true;
  });
  assert.equal(templates.has("A"), true);
});

void test("a usage the fork misses keeps the template: 409 fork-incomplete", async () => {
  brokenFork = true;
  await assert.rejects(remove("A", "1"), (e) => {
    assert.equal(thrownJson(e, 409).code, "fork-incomplete");
    return true;
  });
  assert.equal(templates.has("A"), true);
});
