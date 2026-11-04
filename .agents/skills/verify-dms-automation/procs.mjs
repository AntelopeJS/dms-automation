import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auto, check, fixture, isRow, list, parseJson, pick, text } from "./auto.mjs";

/** @typedef {import("./auto.mjs").Ctx} Ctx */
/** @typedef {import("./auto.mjs").Answer} Answer */
/** @typedef {import("./auto.mjs").Row} Row */
/** @typedef {{ id: string, kind: string, typeId?: string, label?: string, config: Row, position: { x: number, y: number } }} GraphNode */
/** @typedef {{ id: string, from: { node: string, branch?: string }, to: { node: string, branch?: string } }} TriggerEdge */
/** @typedef {{ id: string, from: { node: string, port: string }, to: { node: string, field: string } }} DataEdge */
/** @typedef {{ nodes: GraphNode[], triggerEdges: TriggerEdge[], dataEdges: DataEdge[] }} Graph */

let counter = 0;

/**
 * @param {string} prefix An id prefix
 * @returns {string} An id unique inside the journey
 */
function nextId(prefix) {
  counter += 1;
  return `${prefix}${counter}`;
}

/**
 * A trigger node.
 *
 * @param {string} id The node id
 * @param {string} [typeId] The trigger type, `manual` by default
 * @param {Row} [config] Its settings
 * @returns {GraphNode} The node
 */
export function trigger(id, typeId = "manual", config = {}) {
  return { id, kind: "trigger", typeId, config, position: { x: 0, y: 0 } };
}

/**
 * An action node.
 *
 * @param {string} id The node id
 * @param {string} typeId The action type
 * @param {Row} [config] Its settings
 * @returns {GraphNode} The node
 */
export function action(id, typeId, config = {}) {
  return { id, kind: "action", typeId, config, position: { x: 200, y: 0 } };
}

/**
 * A data node.
 *
 * @param {string} id The node id
 * @param {string} typeId The data node type
 * @param {Row} [config] Its settings
 * @returns {GraphNode} The node
 */
export function data(id, typeId, config = {}) {
  return { id, kind: "data", typeId, config, position: { x: 200, y: 120 } };
}

/**
 * A flow node (`if`, `switch`, `foreach`, `forRange`, `tryCatch`, `retry`, `parallel`, `delay`, `setVariable`).
 *
 * @param {string} id The node id
 * @param {string} kind The flow kind
 * @param {Row} [config] Its settings
 * @returns {GraphNode} The node
 */
export function flow(id, kind, config = {}) {
  return { id, kind, config, position: { x: 200, y: 0 } };
}

/**
 * @param {string} from The node that runs first
 * @param {string} to The node that runs next
 * @param {string} [fromBranch] The branch port of `from`
 * @param {string} [toBranch] The port of `to`
 * @returns {TriggerEdge} The edge
 */
export function tedge(from, to, fromBranch, toBranch) {
  return { id: nextId("te"), from: fromBranch ? { node: from, branch: fromBranch } : { node: from }, to: toBranch ? { node: to, branch: toBranch } : { node: to } };
}

/**
 * @param {string} fromNode The node whose output is wired
 * @param {string} port Its output port
 * @param {string} toNode The node that reads it
 * @param {string} field The input field
 * @returns {DataEdge} The edge
 */
export function dedge(fromNode, port, toNode, field) {
  return { id: nextId("de"), from: { node: fromNode, port }, to: { node: toNode, field } };
}

/**
 * A graph from nodes and edges.
 *
 * @param {GraphNode[]} nodes The nodes
 * @param {TriggerEdge[]} [triggerEdges] The execution edges
 * @param {DataEdge[]} [dataEdges] The data edges
 * @returns {Graph} The graph
 */
export function graph(nodes, triggerEdges = [], dataEdges = []) {
  return { nodes, triggerEdges, dataEdges };
}

/**
 * A graph whose nodes run one after the other from the first.
 *
 * @param {GraphNode[]} nodes The nodes, trigger first
 * @param {DataEdge[]} [dataEdges] The data edges
 * @returns {Graph} The graph
 */
export function chain(nodes, dataEdges = []) {
  return graph(
    nodes,
    nodes.slice(1).map((node, index) => tedge(nodes[index].id, node.id)),
    dataEdges,
  );
}

/**
 * The smallest procedure that runs: a Manual trigger and a Log action.
 *
 * @param {string} message The log message
 * @param {string} [level] The log level
 * @returns {Graph} The graph
 */
export function manualLog(message, level) {
  return chain([trigger("t"), action("log", "log.message", level ? { message, level } : { message })]);
}

/**
 * Creates a disabled draft through Import JSON, the way the dashboard does, and reads back its id.
 *
 * @param {Ctx} ctx The journey
 * @param {{ name?: string, description?: string, graph: Graph }} spec The procedure
 * @returns {Promise<string>} Its id, empty when the import was refused
 */
export async function createProcedure(ctx, spec) {
  const name = spec.name ?? ctx.unique("Procedure");
  const answer = await auto(ctx, `import ${name}`, "POST", "/procedures/import", { body: { json: JSON.stringify({ name, description: spec.description ?? "", graph: spec.graph }) } });
  return text(answer.body, "_id");
}

/**
 * Creates, then enables a procedure.
 *
 * @param {Ctx} ctx The journey
 * @param {{ name?: string, description?: string, graph: Graph }} spec The procedure
 * @returns {Promise<{ id: string, enabled: Answer }>} Its id and the answer to the enable call
 */
export async function createEnabled(ctx, spec) {
  const id = await createProcedure(ctx, spec);
  const enabled = await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
  return { id, enabled };
}

/**
 * Runs the saved procedure as Run now does.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @param {unknown} [payload] The trigger payload
 * @returns {Promise<{ runId: string, status: string, answer: Answer }>} The run id and how it ended
 */
export async function runNow(ctx, id, payload = {}) {
  const answer = await auto(ctx, "run now", "POST", `/procedures/${id}/run-now`, { body: { payload } });
  return { runId: text(answer.body, "runId"), status: text(answer.body, "status"), answer };
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} runId The run
 * @returns {Promise<Row>} The run with its trace
 */
export async function runOf(ctx, runId) {
  const answer = await auto(ctx, "read the run", "GET", `/runs/${runId}`);
  return isRow(answer.body) ? answer.body : {};
}

/**
 * The steps of a run's trace by node id.
 *
 * @param {Row} run The run, as `runOf` reads it
 * @returns {Record<string, Row>} The step of each node that ran, the last one when a node ran several times
 */
export function stepsOf(run) {
  /** @type {Record<string, Row>} */
  const byNode = {};
  for (const step of list(run, "trace", "steps")) byNode[text(step, "nodeId")] = step;
  return byNode;
}

/**
 * Every step of a run's trace, in order.
 *
 * @param {Row} run The run
 * @returns {Row[]} The steps
 */
export function allSteps(run) {
  return list(run, "trace", "steps");
}

/**
 * The log entries of a run.
 *
 * @param {Ctx} ctx The journey
 * @param {string} runId The run
 * @returns {Promise<Row[]>} The entries, oldest first
 */
export async function logsOf(ctx, runId) {
  const answer = await auto(ctx, "read the logs", "GET", `/runs/${runId}/logs`);
  return list(answer.body, "entries");
}

/**
 * The messages of a run's log entries.
 *
 * @param {Row[]} entries The entries
 * @returns {string[]} The messages
 */
export function messages(entries) {
  return entries.map((entry) => text(entry, "message"));
}

/**
 * Polls until `read` returns a value `done` accepts.
 *
 * @template T
 * @param {() => Promise<T>} read Reads the state
 * @param {(value: T) => boolean} done Whether it is final
 * @param {number} [timeoutMs] How long to wait
 * @returns {Promise<T>} The last value read
 */
export async function until(read, done, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await read();
  }
  return value;
}

/**
 * The runs of a procedure, newest first.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @returns {Promise<Row[]>} The runs
 */
export async function runsOfProcedure(ctx, id) {
  const answer = await auto(ctx, "list the procedure's runs", "GET", `/procedures/${id}/runs`);
  return list(answer.body);
}

/**
 * What the fixture's nodes recorded.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<{ entries: Row[], counters: Row }>} The ledger
 */
export async function ledger(ctx) {
  const answer = await fixture(ctx, "read the ledger", "GET", "/ledger");
  return { entries: list(answer.body, "entries"), counters: pick(answer.body, "counters") ?? {} };
}

/** Empties the fixture's ledger and counters.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<void>}
 */
export async function clearLedger(ctx) {
  await fixture(ctx, "clear the ledger", "DELETE", "/ledger");
}

/**
 * Restarts the backend with module options set, then again without them.
 *
 * @param {Ctx} ctx The journey
 * @param {Record<string, string>} env `VERIFY_AUTO_*` variables, see `playground/antelope.config.ts`
 * @param {() => Promise<void>} body What to do while they are set
 * @returns {Promise<void>}
 */
export async function withConfig(ctx, env, body) {
  const previous = { ...ctx.state.extraEnv };
  ctx.state.extraEnv = { ...previous, ...env };
  try {
    await ctx.restartBackend();
    await body();
  } finally {
    ctx.state.extraEnv = previous;
    await ctx.restartBackend();
  }
}

/**
 * Writes declarations to a file in the journey's evidence and returns the `VERIFY_AUTO_DECLARE` setting that makes
 * the fixture call `DeclareProcedure` for each from `start()`.
 *
 * @param {Ctx} ctx The journey
 * @param {unknown[]} declarations The declarations
 * @returns {Record<string, string>} The variable to pass to `withConfig`
 */
export function declareFile(ctx, declarations) {
  const folder = ctx.step("declarations");
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "declarations.json");
  writeFileSync(file, JSON.stringify(declarations, null, 2));
  return { VERIFY_AUTO_DECLARE: file };
}

/**
 * The checks that an answer has a status.
 *
 * @param {Answer} answer The answer
 * @param {number} status The expected status
 * @param {string} [name] The check's name
 * @returns {import("./auto.mjs").Check} The check
 */
export function statusIs(answer, status, name) {
  return check(name ?? `HTTP ${status}`, answer.status === status, `status ${answer.status}: ${JSON.stringify(answer.body)?.slice(0, 300)}`);
}

/**
 * The body of a response as JSON.
 *
 * @param {string} body A body
 * @returns {unknown} Its value
 */
export function asJson(body) {
  return parseJson(body);
}
