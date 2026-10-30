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

const templates = new Map();
const procedures = new Map();

Object.assign(AutomationTemplateModel.prototype, {
  listAll: async () => [...templates.values()].map((t) => structuredClone(t)),
  getById: async (id) => structuredClone(templates.get(id)),
  updateById: async (id, patch) => {
    templates.set(id, { ...templates.get(id), ...patch });
    return structuredClone(templates.get(id));
  },
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
subscriptions.forkUsageToLocal = async (procedureId, nodeId, groupPath) => {
  if (brokenFork) return;
  const p = procedures.get(procedureId);
  const graph = JSON.parse(p.graph);
  let level = graph;
  for (const id of groupPath)
    level = level.nodes.find((n) => n.id === id).subgraph;
  const node = level.nodes.find((n) => n.id === nodeId);
  forkTemplateInstances(
    { nodes: [node], triggerEdges: [], dataEdges: [] },
    templates.get(node.templateId),
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

const node = (id, kind, extra = {}) => ({
  id,
  kind,
  config: {},
  position: { x: 0, y: 0 },
  ...extra,
});
const graph = (...nodes) => ({ nodes, triggerEdges: [], dataEdges: [] });
const instance = (id, templateId) =>
  node(id, "group", { templateId, ports: [] });
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

/** Every group of a graph that still places template `id`. */
function instancesOf(g, id) {
  return g.nodes.flatMap((n) => [
    ...(n.templateId === id ? [n] : []),
    ...(n.subgraph ? instancesOf(n.subgraph, id) : []),
  ]);
}

const remove = (id, force) => new TemplatesController().remove({}, id, force);

void test("deleting forks every usage, nested and in other templates, then removes it", async () => {
  const result = await remove("A", "1");
  assert.deepEqual(result, { _id: "A", forked: 3 });
  assert.equal(templates.has("A"), false);

  const p = JSON.parse(procedures.get("P").graph);
  assert.deepEqual(instancesOf(p, "A"), []);
  const deep = p.nodes[1].subgraph.nodes[0].subgraph.nodes[0];
  assert.equal(deep.label, "Notify");
  assert.deepEqual(deep.subgraph, graph(node("log", "action")));

  const b = templates.get("B").subgraph;
  assert.deepEqual(instancesOf(b, "A"), []);
  assert.equal(b.nodes[0].label, "Notify");
});

void test("without force a used template is refused and listed", async () => {
  await assert.rejects(remove("A"), (e) => {
    assert.equal(e.status, 409);
    const body = JSON.parse(e.body);
    assert.equal(body.code, "in-use");
    assert.equal(body.procedures.length, 2);
    assert.deepEqual(body.procedures[1].groupPath, ["g1", "g2"]);
    assert.equal(body.templates[0].templateId, "B");
    return true;
  });
  assert.equal(templates.has("A"), true);
});

void test("a usage the fork misses keeps the template: 409 fork-incomplete", async () => {
  brokenFork = true;
  await assert.rejects(remove("A", "1"), (e) => {
    assert.equal(e.status, 409);
    assert.equal(JSON.parse(e.body).code, "fork-incomplete");
    return true;
  });
  assert.equal(templates.has("A"), true);
});
