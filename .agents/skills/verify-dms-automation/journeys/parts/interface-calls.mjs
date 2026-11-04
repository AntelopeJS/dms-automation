import { fixture, isRow, isText, list, parseJson, pick, text } from "../../auto.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

/**
 * What a trusted backend call answered.
 *
 * @typedef {{ ok: boolean, result: Row, error: string, status: unknown, body: unknown, raw: unknown }} Outcome
 */

/**
 * @param {unknown} answer The fixture's JSON answer
 * @returns {Outcome} The outcome, the rejection's HTTP body parsed
 */
function outcomeOf(answer) {
  const result = pick(answer, "result");
  const body = pick(answer, "body");
  return {
    ok: pick(answer, "ok") === true,
    result: isRow(result) ? result : {},
    error: text(answer, "error"),
    status: pick(answer, "status"),
    body: isText(body) ? parseJson(body) : body,
    raw: answer,
  };
}

/**
 * `InvokeProcedure(id, payload)` from a trusted backend.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @param {unknown} [payload] The payload, left out when undefined
 * @returns {Promise<Outcome>} The outcome; `result` is the run id when it resolved
 */
export async function invokeProcedure(ctx, id, payload) {
  const answer = await fixture(ctx, `InvokeProcedure(${id})`, "POST", "/invoke", payload === undefined ? { id } : { id, payload });
  const outcome = outcomeOf(answer.body);
  const raw = pick(answer.body, "result");
  return { ...outcome, result: isText(raw) ? { runId: raw } : outcome.result };
}

/**
 * `RunProcedure(id, options)` from a trusted backend.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @param {unknown} [options] The options, left out when undefined
 * @returns {Promise<Outcome>} The outcome
 */
export async function runProcedure(ctx, id, options) {
  const answer = await fixture(ctx, `RunProcedure(${id})`, "POST", "/run", options === undefined ? { id } : { id, options });
  return outcomeOf(answer.body);
}

/**
 * `DeclareProcedure(declaration)` from a trusted backend.
 *
 * @param {Ctx} ctx The journey
 * @param {unknown} declaration The declaration, bad shapes included
 * @returns {Promise<Outcome>} The outcome
 */
export async function declareProcedure(ctx, declaration) {
  const answer = await fixture(ctx, `DeclareProcedure(${text(declaration, "id")})`, "POST", "/declare", declaration);
  return outcomeOf(answer.body);
}

/**
 * Registers a node type built from JSON (see `playground/src/types.ts`).
 *
 * @param {Ctx} ctx The journey
 * @param {Row} spec The type
 * @returns {Promise<boolean>} Whether the fixture registered it
 */
export async function defineType(ctx, spec) {
  const answer = await fixture(ctx, `register ${text(spec, "kind")} ${text(spec, "id")}`, "POST", "/types/define", spec);
  return pick(answer.body, "ok") === true;
}

/**
 * @param {Ctx} ctx The journey
 * @param {"trigger" | "action" | "data"} kind The kind
 * @param {string} id The id
 * @returns {Promise<void>}
 */
export async function unregisterType(ctx, kind, id) {
  await fixture(ctx, `unregister ${kind} ${id}`, "POST", "/types/unregister", {
    kind,
    id,
  });
}

/**
 * The ids `ListTriggerTypes`, `ListActionTypes` and `ListDataNodeTypes` return.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<{ triggers: string[], actions: string[], data: string[] }>} The ids
 */
export async function listedTypes(ctx) {
  const answer = await fixture(ctx, "ListTriggerTypes, ListActionTypes, ListDataNodeTypes", "GET", "/types");
  /** @param {string} key */
  const ids = (key) => {
    const found = pick(answer.body, key);
    return Array.isArray(found) ? found.map(String) : [];
  };
  return {
    triggers: ids("triggers"),
    actions: ids("actions"),
    data: ids("data"),
  };
}

/**
 * @param {string} id The node id
 * @param {string} typeId The trigger type
 * @param {Row} [config] Its settings
 * @returns {Row} The node
 */
export function triggerNode(id, typeId = "manual", config = {}) {
  return { id, kind: "trigger", typeId, config, position: { x: 0, y: 0 } };
}

/**
 * @param {string} id The node id
 * @param {string} typeId The action type
 * @param {Row} [config] Its settings
 * @returns {Row} The node
 */
export function actionNode(id, typeId, config = {}) {
  return { id, kind: "action", typeId, config, position: { x: 200, y: 0 } };
}

/**
 * @param {Row[]} nodes The nodes, a trigger first
 * @returns {Row} The graph that runs them one after the other
 */
export function chainGraph(nodes) {
  return {
    nodes,
    triggerEdges: nodes.slice(1).map((node, index) => ({
      id: `e${index}`,
      from: { node: text(nodes[index], "id") },
      to: { node: text(node, "id") },
    })),
    dataEdges: [],
  };
}

/**
 * @param {string} message The log message
 * @returns {Row} A graph of a Manual trigger and a Log action
 */
export function logGraph(message) {
  return chainGraph([triggerNode("t"), actionNode("log", "log.message", { message })]);
}

/**
 * The step of a run's trace for a node.
 *
 * @param {Row} run The run
 * @param {string} nodeId The node
 * @returns {Row} The step, empty when the node did not run
 */
export function stepOf(run, nodeId) {
  return list(run, "trace", "steps").find((step) => step.nodeId === nodeId) ?? {};
}

/**
 * The plain value of a typed trace value (`{ type, value }`).
 *
 * @param {unknown} typed The typed value
 * @returns {unknown} Its value
 */
export function valueOf(typed) {
  return pick(typed, "value");
}
