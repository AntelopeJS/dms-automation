const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  forkTemplateInstances,
  walkPlacedNodes,
} = require("../dist/runtime/resolveSubgraph.js");

// How the library finds where a block is used, and how deleting a template
// turns its instances into local groups: through nested groups and through
// the templates a procedure places.

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
const localGroup = (id, subgraph, label) =>
  node(id, "group", { ports: [], subgraph, label });

const templates = new Map([
  ["inner", { subgraph: graph(node("echo", "action", { typeId: "echo" })) }],
  ["outer", { subgraph: graph(instance("i2", "inner")) }],
  // A reference cycle (refused on save, but a stored graph may hold one).
  ["loop", { subgraph: graph(instance("again", "loop")) }],
]);

const placed = (g) =>
  [...walkPlacedNodes(g, templates)].map(
    ({ node: n, groups, viaTemplate }) => ({
      id: n.id,
      groups: groups.map((x) => x.id),
      via: viaTemplate?.id,
    }),
  );

test("a node inside nested local groups is reached with its group path", () => {
  const g = graph(
    localGroup("g1", graph(localGroup("g2", graph(node("log", "action"))))),
  );
  assert.deepEqual(placed(g).at(-1), {
    id: "log",
    groups: ["g1", "g2"],
    via: undefined,
  });
});

test("a node inside a template is reached through the outermost instance", () => {
  const g = graph(localGroup("g1", graph(instance("i1", "outer"))));
  assert.deepEqual(placed(g).at(-1), { id: "echo", groups: ["g1"], via: "i1" });
});

test("a missing or cyclic template is not entered", () => {
  assert.deepEqual(placed(graph(instance("x", "missing"))), [
    { id: "x", groups: [], via: undefined },
  ]);
  assert.equal(placed(graph(instance("l", "loop"))).length, 2);
});

test("forking turns every instance, nested ones included, into a local group", () => {
  const sub = graph(node("echo", "action"));
  const template = { _id: "T", name: "Notify", subgraph: sub };
  const labelled = { ...instance("b", "T"), label: "Mine" };
  const g = graph(
    instance("a", "T"),
    localGroup("g1", graph(labelled, instance("c", "other"))),
  );
  assert.equal(forkTemplateInstances(g, template), 2);
  const [a, g1] = g.nodes;
  const [b, c] = g1.subgraph.nodes;
  for (const forked of [a, b]) {
    assert.equal(forked.templateId, undefined);
    assert.deepEqual(forked.subgraph, sub);
    assert.notEqual(forked.subgraph, sub, "each fork owns its copy");
  }
  // The group keeps the name the builder showed: the template's, or its own.
  assert.equal(a.label, "Notify");
  assert.equal(b.label, "Mine");
  assert.equal(c.templateId, "other");
});
