const assert = require("node:assert/strict");
const http = require("node:http");
const { after, before, test } = require("node:test");
const {
  builtinActions,
  builtinDataNodes,
  builtinTriggers,
} = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { run } = require("../dist/runtime/executor.js");
const { traceOf } = require("../dist/runtime/trace.js");
const {
  setHttpRequestOptions,
} = require("../dist/runtime/builtins/actions/http.js");
const { isPropertyBag } = require("../dist/types/guards.js");

/** @typedef {import("../dist/types/dataValue.js").DataValue} DataValue */
/** @typedef {import("../dist/types/dataValue.js").DataRecord} DataRecord */
/** @typedef {import("../dist/types/graph.js").GraphNode} GraphNode */
/** @typedef {import("../dist/types/graph.js").DataEdge} DataEdge */
/** @typedef {import("../dist/types/graph.js").TriggerEdge} TriggerEdge */
/** @typedef {import("../dist/types/graph.js").ProcedureGraph} ProcedureGraph */
/** @typedef {import("../dist/runtime/executionResult.js").ExecutionResult} ExecutionResult */

for (const t of builtinTriggers) registry.addTrigger(t.id, t);
for (const a of builtinActions) registry.addAction(a.id, a);
for (const d of builtinDataNodes) registry.addDataNode(d.id, d);

/**
 * @param {string} id
 * @param {string} kind
 * @param {string} [typeId]
 * @param {DataRecord} [config]
 * @returns {GraphNode}
 */
function node(id, kind, typeId, config = {}) {
  const n = { id, kind, config, position: { x: 0, y: 0 } };
  if (typeId) n.typeId = typeId;
  return n;
}

const trigger = node("t", "trigger", "manual");

/**
 * @param {string} from
 * @param {string} to
 * @param {string} [branch]
 * @returns {TriggerEdge}
 */
function edge(from, to, branch) {
  /** @type {TriggerEdge} */
  const e = { id: `${from}-${to}`, from: { node: from }, to: { node: to } };
  if (branch) e.from.branch = branch;
  return e;
}

/**
 * @param {string} from
 * @param {string} port
 * @param {string} to
 * @param {string} field
 * @returns {DataEdge}
 */
function wire(from, port, to, field) {
  return {
    id: `${from}.${port}-${to}.${field}`,
    from: { node: from, port },
    to: { node: to, field },
  };
}

/**
 * The value reached by following `keys` through nested objects.
 * @param {unknown} root
 * @param {...string} keys
 * @returns {unknown}
 */
function at(root, ...keys) {
  let current = root;
  for (const key of keys) {
    assert.ok(isPropertyBag(current));
    current = current[key];
  }
  return current;
}

/**
 * The output of `nodeId`'s last "executed" log entry.
 * @param {ExecutionResult} result
 * @param {string} nodeId
 * @returns {unknown}
 */
function outputOf(result, nodeId) {
  const entry = result.logs.entries.findLast(
    (e) => e.nodeId === nodeId && e.message === "executed",
  );
  return entry && at(entry.value, "output", "value");
}

/**
 * `outputOf`, for a node whose output is an object.
 * @param {ExecutionResult} result
 * @param {string} nodeId
 * @returns {Record<string, unknown>}
 */
function outputRecord(result, nodeId) {
  const output = outputOf(result, nodeId);
  assert.ok(isPropertyBag(output));
  return output;
}

/**
 * Runs `data` (a data node) wired into a Log and returns its result.
 * @param {string} typeId
 * @param {DataRecord} config
 * @returns {Promise<{ value?: unknown, error?: string, failedNodeId?: string }>}
 */
async function evaluate(typeId, config) {
  const result = await run(
    {
      nodes: [
        trigger,
        node("d", "data", typeId, config),
        node("log", "action", "log.message"),
      ],
      triggerEdges: [edge("t", "log")],
      dataEdges: [wire("d", "result", "log", "value")],
    },
    "t",
    {},
  );
  return result.status === "ok"
    ? { value: outputRecord(result, "log").value }
    : { error: result.errorMessage, failedNodeId: result.failedNodeId };
}

void test("Set variable feeds its value port", async () => {
  const result = await run(
    {
      nodes: [
        trigger,
        node("sv", "setVariable", undefined, { name: "x", value: 5 }),
        node("log", "action", "log.message"),
      ],
      triggerEdges: [edge("t", "sv"), edge("sv", "log")],
      dataEdges: [wire("sv", "value", "log", "value")],
    },
    "t",
    {},
  );
  assert.equal(result.status, "ok");
  assert.deepEqual(outputOf(result, "sv"), { value: 5 });
  assert.equal(outputRecord(result, "log").value, 5);
});

void test("a data node that fails fails the step that reads it", async () => {
  const graph = {
    nodes: [
      trigger,
      node("bad", "data", "math.sqrt", { a: -4 }),
      node("log", "action", "log.message"),
    ],
    triggerEdges: [edge("t", "log")],
    dataEdges: [wire("bad", "result", "log", "value")],
  };
  const result = await run(graph, "t", {});
  assert.equal(result.status, "failed");
  assert.equal(result.failedNodeId, "log");
  assert.match(result.errorMessage, /^math\.sqrt: no valid result/);
  const trace = traceOf(graph, result.logs, { nodeId: "t", payload: {} });
  assert.deepEqual(
    trace.steps.map((s) => [s.nodeId, s.status]),
    [
      ["t", "ok"],
      ["log", "failed"],
    ],
  );
});

void test("Compare reads numbers written as text as numbers", async () => {
  assert.equal((await evaluate("compare.gt", { a: "10", b: "9" })).value, true);
  assert.equal((await evaluate("compare.eq", { a: 5, b: "5" })).value, true);
  assert.equal((await evaluate("compare.lt", { a: "2.5", b: 10 })).value, true);
  assert.equal(
    (await evaluate("compare.eq", { a: "abc", b: "abc" })).value,
    true,
  );
  assert.equal((await evaluate("compare.eq", { a: "01", b: "1" })).value, true);
});

void test("Compare in auto mode keeps null, booleans and hex apart", async () => {
  /**
   * @param {DataValue} a
   * @param {DataValue} b
   */
  const eq = async (a, b) => (await evaluate("compare.eq", { a, b })).value;
  assert.equal(await eq(null, ""), false);
  assert.equal(await eq("0x10", 16), false);
  assert.equal(await eq(true, "true"), false);
  assert.equal(await eq(null, null), true);
  assert.equal(await eq(true, true), true);
  assert.equal(await eq("1e3", 1000), true);
});

void test("Compare in text mode compares in alphabetical order", async () => {
  const gt = await evaluate("compare.gt", { a: "10", b: "9", mode: "text" });
  assert.equal(gt.value, false);
  const eq = await evaluate("compare.eq", { a: "01", b: "1", mode: "text" });
  assert.equal(eq.value, false);
});

void test("Compare in number mode fails on a value that is not a number", async () => {
  const r = await evaluate("compare.gt", { a: "abc", b: 1, mode: "number" });
  assert.match(r.error, /a is not a number/);
});

void test("the text false is false for the boolean nodes and If", async () => {
  assert.equal(
    (await evaluate("bool.and", { a: "false", b: "true" })).value,
    false,
  );
  assert.equal(
    (await evaluate("bool.or", { a: "0", b: "false" })).value,
    false,
  );
  assert.equal((await evaluate("bool.not", { a: "false" })).value, true);

  const result = await run(
    {
      nodes: [
        trigger,
        node("if", "if", undefined, { cond: "false" }),
        node("yes", "action", "log.message"),
        node("no", "action", "log.message"),
      ],
      triggerEdges: [
        edge("t", "if"),
        edge("if", "yes", "then"),
        edge("if", "no", "else"),
      ],
      dataEdges: [],
    },
    "t",
    {},
  );
  assert.equal(outputOf(result, "yes"), undefined);
  assert.notEqual(outputOf(result, "no"), undefined);
});

void test("Math fails by name instead of returning NaN", async () => {
  const sqrt = await evaluate("math.sqrt", { a: -4 });
  assert.match(sqrt.error, /math\.sqrt: no valid result for a = -4/);
  assert.equal(sqrt.failedNodeId, "log");
  const add = await evaluate("math.add", { a: "abc", b: 1 });
  assert.match(add.error, /math\.add: a is not a number \("abc"\)/);
  const power = await evaluate("math.power", { a: 10, b: 400 });
  assert.match(power.error, /no valid result/);
});

void test("Math reads numbers written as text and keeps null for a division by zero", async () => {
  assert.equal((await evaluate("math.add", { a: "2", b: 3 })).value, 5);
  assert.equal((await evaluate("math.divide", { a: 1, b: 0 })).value, null);
  assert.equal((await evaluate("math.add", { b: 3 })).value, 3);
});

void test("an empty input names the step it comes from", async () => {
  const result = await run(
    {
      nodes: [
        trigger,
        node("div", "data", "math.divide", { a: 1, b: 0 }),
        node("add", "data", "math.add", { b: 1 }),
        node("log", "action", "log.message"),
      ],
      triggerEdges: [edge("t", "log")],
      dataEdges: [
        wire("div", "result", "add", "a"),
        wire("add", "result", "log", "value"),
      ],
    },
    "t",
    {},
  );
  assert.equal(result.failedNodeId, "log");
  assert.equal(
    result.errorMessage,
    "math.add: a is not a number (empty). a comes from math.divide (result), which gave no value.",
  );
});

void test("text nodes count characters as a reader does", async () => {
  assert.equal((await evaluate("string.length", { s: "😀ab" })).value, 3);
  assert.equal((await evaluate("string.length", { s: "👍🏽é" })).value, 2);
  const sub = await evaluate("string.substring", {
    s: "😀ab",
    start: 0,
    end: 1,
  });
  assert.equal(sub.value, "😀");
  const swapped = await evaluate("string.substring", {
    s: "hello",
    start: 4,
    end: 1,
  });
  assert.equal(swapped.value, "ell");
});

void test("a constant saved without a value emits its schema default", async () => {
  const result = await run(
    {
      nodes: [
        trigger,
        node("c", "data", "const.number"),
        node("log", "action", "log.message"),
      ],
      triggerEdges: [edge("t", "log")],
      dataEdges: [wire("c", "value", "log", "value")],
    },
    "t",
    {},
  );
  assert.equal(outputRecord(result, "log").value, 0);
});

/** @type {import("node:http").Server} */
let server;
/** @type {string} */
let base;
/**
 * A local port nothing listens on.
 * @type {number}
 */
let closedPort;

/**
 * @param {import("node:http").Server} listening
 * @returns {number}
 */
function portOf(listening) {
  const address = listening.address();
  assert.ok(isPropertyBag(address));
  return address.port;
}

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/ok") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({ ok: true, auth: req.headers.authorization ?? null }),
      );
    } else if (req.url === "/missing") {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "booking not found" }));
    } else if (req.url === "/big") {
      res.end("x".repeat(3 * 1024 * 1024));
    } else if (req.url === "/slow") {
    } else {
      res.statusCode = 500;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${portOf(server)}`;
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  closedPort = portOf(probe);
  await new Promise((resolve) => probe.close(resolve));
});

after(() => {
  server.closeAllConnections();
  server.close();
});

/**
 * @param {DataRecord} config
 * @returns {ProcedureGraph}
 */
function httpGraph(config) {
  return {
    nodes: [trigger, node("h", "action", "http.request", config)],
    triggerEdges: [edge("t", "h")],
    dataEdges: [],
  };
}

void test("a failed status names the request and quotes the response", async () => {
  const result = await run(
    httpGraph({ url: `${base}/missing`, method: "POST" }),
    "t",
    {},
  );
  assert.equal(result.status, "failed");
  assert.equal(result.failedNodeId, "h");
  assert.match(
    result.errorMessage,
    new RegExp(`^POST ${base}/missing → 404 Not Found\\.`),
  );
  assert.match(result.errorMessage, /Check the URL\./);
  assert.match(result.errorMessage, /booking not found/);
});

void test("failOnStatus off hands the status, headers, body and JSON to the graph", async () => {
  const result = await run(
    httpGraph({ url: `${base}/missing`, failOnStatus: false }),
    "t",
    {},
  );
  assert.equal(result.status, "ok");
  const out = outputRecord(result, "h");
  assert.equal(out.status, 404);
  assert.equal(at(out, "headers", "content-type"), "application/json");
  assert.deepEqual(out.json, { error: "booking not found" });
});

void test("network failures are said in words", async () => {
  const refused = await run(
    httpGraph({ url: `http://127.0.0.1:${closedPort}/` }),
    "t",
    {},
  );
  assert.match(
    refused.errorMessage,
    /connection refused by 127\.0\.0\.1:\d+.*\(ECONNREFUSED\)/,
  );
  const unknown = await run(
    httpGraph({ url: "http://doesnotexist.invalid/" }),
    "t",
    {},
  );
  assert.match(unknown.errorMessage, /host not found: doesnotexist\.invalid/);
  const ftp = await run(httpGraph({ url: "ftp://example.com/" }), "t", {});
  assert.match(ftp.errorMessage, /Only http:\/\/ and https:\/\/ URLs/);
  const empty = await run(httpGraph({ url: "" }), "t", {});
  assert.match(empty.errorMessage, /The URL is empty/);
  const headers = await run(
    httpGraph({ url: `${base}/ok`, headers: "x" }),
    "t",
    {},
  );
  assert.match(headers.errorMessage, /Headers must be an object/);
});

void test("a request that gets no answer fails after its timeout", async () => {
  const started = Date.now();
  const result = await run(
    httpGraph({ url: `${base}/slow`, timeoutMs: 300 }),
    "t",
    {},
  );
  assert.ok(Date.now() - started < 5000);
  assert.match(result.errorMessage, /no response after 0\.3 s/);
});

void test("a timeout above 5 minutes is capped, and the log says so", async () => {
  const result = await run(
    httpGraph({ url: `${base}/ok`, timeoutMs: 10 * 60 * 60 * 1000 }),
    "t",
    {},
  );
  assert.equal(result.status, "ok");
  assert.ok(
    result.logs.entries.some(
      (e) => e.level === "warn" && /timeoutMs capped at 300000/.test(e.message),
    ),
  );
});

void test("a response over the size limit is refused", async () => {
  const result = await run(httpGraph({ url: `${base}/big` }), "t", {});
  assert.match(result.errorMessage, /larger than 2 MB/);
});

void test("header values are masked in the run log, not in the request", async () => {
  const result = await run(
    httpGraph({
      url: `${base}/ok`,
      headers: {
        Authorization: "Bearer sk_live_SECRET",
        Accept: "application/json",
      },
    }),
    "t",
    {},
  );
  assert.equal(result.status, "ok");
  const logged = JSON.stringify(result.logs);
  assert.equal(
    at(outputOf(result, "h"), "json", "auth"),
    "Bearer sk_live_SECRET",
  );
  const executed = result.logs.entries.find(
    (e) => e.nodeId === "h" && e.message === "executed",
  );
  assert.ok(executed);
  assert.equal(
    at(executed.value, "inputs", "headers", "value", "Authorization"),
    "[redacted]",
  );
  assert.equal(
    at(executed.value, "inputs", "headers", "value", "Accept"),
    "application/json",
  );
  assert.ok(logged.includes("[redacted]"));
});

void test("blockPrivateNetwork refuses loopback addresses", async () => {
  setHttpRequestOptions({ blockPrivateNetwork: true });
  try {
    const result = await run(httpGraph({ url: `${base}/ok` }), "t", {});
    assert.match(
      result.errorMessage,
      /private network address \(127\.0\.0\.1\)/,
    );
    const v6 = await run(httpGraph({ url: "http://[::1]:9/" }), "t", {});
    assert.match(v6.errorMessage, /private network address/);
    const metadata = await run(
      httpGraph({ url: "http://169.254.169.254/" }),
      "t",
      {},
    );
    assert.match(metadata.errorMessage, /private network address/);
    const nat64 = await run(
      httpGraph({ url: "http://[64:ff9b::7f00:1]/" }),
      "t",
      {},
    );
    assert.match(nat64.errorMessage, /private network address/);
    const nat64Public = await run(
      httpGraph({ url: "http://[64:ff9b::808:808]/", timeoutMs: 200 }),
      "t",
      {},
    );
    assert.doesNotMatch(nat64Public.errorMessage, /private network address/);
  } finally {
    setHttpRequestOptions({});
  }
});

void test("a parallel waits for every branch and reports the first failure", async () => {
  const graph = {
    nodes: [
      trigger,
      node("p", "parallel", undefined, { ports: ["a", "b"] }),
      node("ha", "action", "http.request", {
        url: `${base}/slow`,
        timeoutMs: 400,
      }),
      node("hb", "action", "http.request", { url: `${base}/missing` }),
    ],
    triggerEdges: [edge("t", "p"), edge("p", "ha", "a"), edge("p", "hb", "b")],
    dataEdges: [],
  };
  const result = await run(graph, "t", {});
  assert.equal(result.status, "failed");
  assert.equal(result.failedNodeId, "hb");
  assert.match(result.errorMessage, /404/);
  const trace = traceOf(graph, result.logs, { nodeId: "t", payload: {} });
  const status = Object.fromEntries(
    trace.steps.map((s) => [s.nodeId, s.status]),
  );
  assert.equal(status.ha, "failed");
  assert.equal(status.hb, "failed");
});
