import { check, fixture, isRow, isText, list, pick, same, text } from "../../auto.mjs";
import { action, allSteps, chain, createProcedure, data, dedge, ledger, logsOf, runNow, runOf, trigger } from "../../procs.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */
/** @typedef {import("../../procs.mjs").Graph} Graph */

/**
 * @typedef {object} Ran
 * @property {string} id The procedure
 * @property {string} runId The run
 * @property {string} status `ok` or `failed`
 * @property {Row} run The run with its trace
 * @property {Row[]} steps Every step of the trace, in order
 * @property {Row[]} entries The run's log entries, oldest first
 * @property {string | null} error The run's error message
 * @property {string | null} failedNodeId The node the run failed at
 */

/**
 * Creates a draft from a graph and runs it as Run now does, then reads the run back through the run API and its logs.
 *
 * @param {Ctx} ctx The journey
 * @param {Graph} graph The graph
 * @param {{ payload?: unknown, name?: string }} [options] The trigger payload and the procedure's name
 * @returns {Promise<Ran>} The run
 */
export async function runGraph(ctx, graph, options = {}) {
  const id = await createProcedure(ctx, { name: options.name, graph });
  const ran = await runNow(ctx, id, options.payload ?? {});
  const run = await runOf(ctx, ran.runId);
  const entries = await logsOf(ctx, ran.runId);
  return {
    id,
    runId: ran.runId,
    status: ran.status,
    run,
    steps: allSteps(run),
    entries,
    error: isText(run.errorMessage) ? run.errorMessage : null,
    failedNodeId: isText(run.failedNodeId) ? run.failedNodeId : null,
  };
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {Row} The value when it is an object, else an empty object
 */
export function rowOf(value) {
  return isRow(value) ? value : {};
}

/**
 * @param {Ran} ran The run
 * @param {string} nodeId A node
 * @returns {Row[]} The steps of that node, one per execution
 */
export function stepsOfNode(ran, nodeId) {
  return ran.steps.filter((step) => step.nodeId === nodeId);
}

/**
 * @param {Row | undefined} step A step
 * @param {string} field An input field
 * @returns {unknown} The value the step received on that field, undefined when the field was not given
 */
export function inputValue(step, field) {
  return pick(step, "inputs", field, "value");
}

/**
 * @param {Row | undefined} step A step
 * @param {string} field An input field
 * @returns {unknown} The type tag the trace gives that input
 */
export function inputType(step, field) {
  return pick(step, "inputs", field, "type");
}

/**
 * @param {Row | undefined} step A step
 * @returns {unknown} The output object of the step, without its type tag
 */
export function outputValue(step) {
  return pick(step, "output", "value");
}

/**
 * The entries an action wrote itself, that is the Log action's and `ctx.log`'s, with the engine's own entries left out.
 *
 * @param {Ran} ran The run
 * @returns {{ level: string, message: string, value: unknown, nodeId: string }[]} The entries, oldest first
 */
export function userLogs(ran) {
  return ran.entries
    .filter((entry) => entry.source === "log")
    .map((entry) => ({ level: text(entry, "level"), message: text(entry, "message"), value: entry.value, nodeId: text(entry, "nodeId") }));
}

/**
 * @param {Ran} ran The run
 * @returns {string[]} The messages of the user log entries, oldest first
 */
export function userMessages(ran) {
  return userLogs(ran).map((entry) => entry.message);
}

/**
 * The node ids of the steps that ran, in order.
 *
 * @param {Ran} ran The run
 * @returns {string[]} The ids, one per executed step
 */
export function ranOrder(ran) {
  return ran.steps.map((step) => text(step, "nodeId"));
}

/**
 * The checks of a run that must have ended a given way.
 *
 * @param {string} label What the run is
 * @param {Ran} ran The run
 * @param {"ok" | "failed"} status The status it must have
 * @returns {import("../../auto.mjs").Check} The check
 */
export function endedAs(label, ran, status) {
  return check(`${label} ends ${status}`, ran.status === status && ran.run.status === status, `answer ${ran.status}, run ${String(ran.run.status)}, error ${ran.error}`);
}

/**
 * Evaluates data nodes in one run: each case becomes a data node wired to its own Log step, whose received `value` is
 * the node's output. A case with no `port` reads `result`.
 *
 * @typedef {{ label: string, type: string, config?: Row, port?: string, expect: unknown, expectType?: string }} DataCase
 * @param {Ctx} ctx The journey
 * @param {DataCase[]} cases The cases
 * @returns {Promise<{ ran: Ran, checks: import("../../auto.mjs").Check[] }>} The run and one check per case
 */
export async function evaluateCases(ctx, cases) {
  /** @type {import("../../procs.mjs").GraphNode[]} */
  const logs = [];
  /** @type {import("../../procs.mjs").GraphNode[]} */
  const nodes = [];
  /** @type {import("../../procs.mjs").DataEdge[]} */
  const edges = [];
  cases.forEach((one, index) => {
    logs.push(action(`l${index}`, "log.message", { message: one.label }));
    nodes.push(data(`d${index}`, one.type, one.config ?? {}));
    edges.push(dedge(`d${index}`, one.port ?? "result", `l${index}`, "value"));
  });
  const flowGraph = chain([trigger("t"), ...logs], edges);
  flowGraph.nodes.push(...nodes);
  const ran = await runGraph(ctx, flowGraph);
  const checks = [endedAs("the run", ran, "ok")];
  cases.forEach((one, index) => {
    const step = stepsOfNode(ran, `l${index}`)[0];
    checks.push(same(one.label, inputValue(step, "value"), one.expect));
    if (one.expectType !== undefined) checks.push(same(`${one.label}: type`, inputType(step, "value"), one.expectType));
  });
  return { ran, checks };
}

/**
 * Runs a graph with one data node feeding a Log, and reads how the run failed.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What is tried
 * @param {string} type The data node type
 * @param {Row} config Its settings
 * @param {string} message The error message the run must carry
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function failureCase(ctx, label, type, config, message) {
  const ran = await runGraph(
    ctx,
    chain([trigger("t"), action("l", "log.message", {}), data("d", type, config)], [dedge("d", "result", "l", "value")]),
  );
  return [endedAs(label, ran, "failed"), same(`${label}: the run's error`, ran.error, message), same(`${label}: the step that failed`, ran.failedNodeId, "l")];
}

/**
 * The fixture ledger entries of a kind.
 *
 * @param {Ctx} ctx The journey
 * @param {string} kind The entry kind
 * @returns {Promise<Row[]>} The entries, oldest first
 */
export async function ledgerOf(ctx, kind) {
  const all = await ledger(ctx);
  return all.entries.filter((entry) => entry.kind === kind);
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<{ base: string, received: Row[] }>} The sink's address and what it received
 */
export async function sinkState(ctx) {
  const answer = await fixture(ctx, "read the sink", "GET", "/sink");
  return { base: text(answer.body, "base"), received: list(answer.body, "received") };
}
