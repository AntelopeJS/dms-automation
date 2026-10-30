const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  builtinActions,
  builtinDataNodes,
  builtinTriggers,
} = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const {
  graphIssues,
  hasBlockingIssue,
  hasTrigger,
} = require("../dist/runtime/graphIssues.js");
const { validateGraph } = require("../dist/runtime/validate.js");
const {
  webhookPathProblem,
} = require("../dist/runtime/builtins/triggers/webhook.js");
const { changesExecution } = require("../dist/runtime/graphVersion.js");

/** The module registers its built-in types at start; the tests do it here. */
for (const t of builtinTriggers) registry.addTrigger(t.id, t);
for (const a of builtinActions) registry.addAction(a.id, a);
for (const d of builtinDataNodes) registry.addDataNode(d.id, d);

const node = (id, kind, typeId, config = {}) => ({
  id,
  kind,
  typeId,
  config,
  position: { x: 0, y: 0 },
});

const graphOf = (nodes, triggerEdges = [], dataEdges = []) => ({
  nodes,
  triggerEdges,
  dataEdges,
});

const edge = (id, from, to) => ({ id, from: { node: from }, to: { node: to } });

const codes = (issues) => issues.map((i) => i.code);

void test("a step nothing triggers is a warning on its node", () => {
  const graph = graphOf(
    [
      node("t", "trigger", "manual"),
      node("a", "action", "log.message"),
      node("b", "action", "log.message"),
    ],
    [edge("e", "t", "a")],
  );
  const issues = graphIssues(graph);
  assert.deepEqual(issues, [
    {
      severity: "warning",
      code: "untriggered",
      message: "nothing triggers this step, it can never run",
      nodeId: "b",
    },
  ]);
  assert.equal(hasBlockingIssue(issues), false);
});

void test("validator errors are blocking and point at the node they name", () => {
  const graph = graphOf(
    [node("t", "trigger", "manual"), node("a", "action", "log.message")],
    [edge("e1", "t", "a"), edge("e2", "a", "t")],
    [
      {
        id: "d1",
        from: { node: "t", port: "x" },
        to: { node: "a", field: "message" },
      },
      {
        id: "d2",
        from: { node: "t", port: "y" },
        to: { node: "a", field: "message" },
      },
    ],
  );
  const issues = graphIssues(graph);
  assert.equal(hasBlockingIssue(issues), true);
  const fanIn = issues.find((i) => i.code === "dataFanIn");
  assert.equal(fanIn.nodeId, "a");
  assert.deepEqual(fanIn.params, { node: "a", field: "message" });
  const targeted = issues.find((i) => i.code === "triggerTargeted");
  assert.equal(targeted.nodeId, "t");
});

void test("a trigger cycle names the nodes on it", () => {
  const graph = graphOf(
    [
      node("t", "trigger", "manual"),
      node("a", "action", "log.message"),
      node("b", "action", "log.message"),
      node("c", "action", "log.message"),
    ],
    [edge("e1", "t", "a"), edge("e2", "a", "b"), edge("e3", "b", "a")],
  );
  const cycle = graphIssues(graph).find((i) => i.code === "triggerCycle");
  assert.equal(cycle.severity, "error");
  assert.deepEqual(cycle.params, { nodes: "a, b" });
  assert.equal(cycle.nodeId, "a");
});

void test("a loop among data nodes is an error", () => {
  const data = (id, from, to) => ({
    id,
    from: { node: from, port: "result" },
    to: { node: to, field: "a" },
  });
  const graph = graphOf(
    [node("x", "data", "math.add"), node("y", "data", "math.add")],
    [],
    [data("d1", "x", "y"), data("d2", "y", "x")],
  );
  const issues = graphIssues(graph);
  assert.deepEqual(codes(issues), ["dataCycle"]);
  assert.equal(validateGraph(graph).ok, false);
});

void test("unknown types, duplicate ids and missing templates are errors", () => {
  const graph = graphOf(
    [
      node("t", "trigger", "nope.trigger"),
      node("l", "action", "log.message"),
      node("l", "action", "nope.action"),
      {
        ...node("g", "group"),
        templateId: "gone",
        ports: [{ name: "in", kind: "trigger", direction: "in" }],
      },
    ],
    [edge("e1", "t", "l"), edge("e2", "t", "g")],
  );
  const issues = graphIssues(graph, { templates: { has: () => false } });
  assert.deepEqual(codes(issues).sort(), [
    "duplicateNodeId",
    "unknownTemplate",
    "unknownType",
    "unknownType",
  ]);
  assert.ok(issues.every((i) => i.severity === "error"));
});

void test("a trigger inside a group is reported on the group", () => {
  const subgraph = graphOf(
    [
      node("in", "groupInput"),
      node("out", "groupOutput"),
      node("inner", "trigger", "manual"),
    ],
    [edge("s1", "in", "out")],
  );
  const graph = graphOf(
    [
      node("t", "trigger", "manual"),
      {
        ...node("g", "group"),
        ports: [{ name: "in", kind: "trigger", direction: "in" }],
        subgraph,
      },
    ],
    [edge("e1", "t", "g")],
  );
  const nested = graphIssues(graph).find((i) => i.code === "nestedTrigger");
  assert.equal(nested.nodeId, "g");
  assert.match(nested.message, /^group:g > /);
});

void test("trigger settings that can never fire are errors", () => {
  const graph = graphOf([
    node("cron", "trigger", "schedule.cron", { cron: "every banana" }),
    node("hook", "trigger", "webhook", { path: "hello world" }),
    node("api", "trigger", "webhook", { path: "/api/automation/runs" }),
  ]);
  const issues = graphIssues(graph);
  assert.deepEqual(codes(issues), [
    "cronInvalid",
    "webhookPathInvalid",
    "webhookPathReserved",
  ]);
  assert.deepEqual(
    issues.map((i) => i.nodeId),
    ["cron", "hook", "api"],
  );
});

void test("an empty required setting warns on a draft and blocks enabling", () => {
  const graph = graphOf(
    [node("t", "trigger", "manual"), node("h", "action", "http.request")],
    [edge("e", "t", "h")],
  );
  const draft = graphIssues(graph);
  assert.deepEqual(draft, [
    {
      severity: "warning",
      code: "missingField",
      params: { field: "url", label: "URL" },
      message: "URL is empty",
      nodeId: "h",
    },
  ]);
  assert.equal(hasBlockingIssue(graphIssues(graph, { enabling: true })), true);
  const wired = {
    ...graph,
    nodes: [...graph.nodes, node("c", "data", "const.string")],
    dataEdges: [
      {
        id: "d",
        from: { node: "c", port: "value" },
        to: { node: "h", field: "url" },
      },
    ],
  };
  assert.deepEqual(graphIssues(wired, { enabling: true }), []);
});

void test("two webhooks of one graph cannot share a route", () => {
  const graph = graphOf([
    node("a", "trigger", "webhook", { path: "/webhooks/x", method: "POST" }),
    node("b", "trigger", "webhook", { path: "/webhooks/x/" }),
  ]);
  const issues = graphIssues(graph);
  assert.deepEqual(codes(issues), ["webhookPathDuplicate"]);
  assert.equal(issues[0].nodeId, "b");
});

void test("enabling needs a trigger", () => {
  const issues = graphIssues(graphOf([]), { enabling: true });
  assert.deepEqual(codes(issues), ["noTrigger"]);
  assert.deepEqual(graphIssues(graphOf([])), []);
});

void test("webhook paths stay out of the API and accept route parameters", () => {
  assert.equal(webhookPathProblem("/webhooks/orders/:id"), undefined);
  assert.equal(webhookPathProblem("/api").code, "webhookPathReserved");
  assert.equal(webhookPathProblem("/DMS/x").code, "webhookPathReserved");
  assert.equal(
    webhookPathProblem("/webhooks/../api").code,
    "webhookPathInvalid",
  );
  assert.equal(webhookPathProblem(undefined).code, "webhookPathInvalid");
});

void test("a loop set past the iteration limit is a warning", () => {
  const loop = (config) =>
    graphOf(
      [
        node("t", "trigger", "manual"),
        node("f", "forRange", undefined, config),
      ],
      [edge("e", "t", "f")],
    );
  const issues = graphIssues(loop({ start: 0, end: 20000, step: 1 }));
  assert.deepEqual(issues, [
    {
      severity: "warning",
      code: "loopTooLong",
      params: { count: 20000, max: 10000 },
      message:
        "this loop would run 20000 times, more than the 10000 a run allows: it will fail",
      nodeId: "f",
    },
  ]);
  assert.deepEqual(graphIssues(loop({ start: 0, end: 10000, step: 1 })), []);
  assert.deepEqual(graphIssues(loop({ start: 0, end: 20000, step: 2 })), []);
});

void test("a graph has a trigger when any node is one", () => {
  assert.equal(hasTrigger(graphOf([node("t", "trigger", "manual")])), true);
  assert.equal(hasTrigger(graphOf([])), false);
});

void test("moving or restyling nodes does not change what a run executes", () => {
  const group = {
    ...node("g", "group"),
    ports: [{ name: "in", kind: "trigger", direction: "in" }],
    subgraph: graphOf([node("in", "groupInput"), node("out", "groupOutput")]),
  };
  const graph = graphOf(
    [node("t", "trigger", "manual"), node("a", "action", "log.message"), group],
    [edge("e", "t", "a")],
  );
  const stored = JSON.stringify(graph);
  const moved = structuredClone(graph);
  moved.nodes[1].position = { x: 120, y: 40 };
  moved.nodes[1].width = 240;
  moved.nodes[2].subgraph.nodes[0].position = { x: 9, y: 9 };
  assert.equal(changesExecution(stored, moved), false);
  const edited = structuredClone(graph);
  edited.nodes[1].config = { message: "hello" };
  assert.equal(changesExecution(stored, edited), true);
  const rewired = structuredClone(graph);
  rewired.triggerEdges = [];
  assert.equal(changesExecution(stored, rewired), true);
});
