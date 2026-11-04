import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { action, chain, createProcedure, graph, tedge, trigger } from "../../procs.mjs";
import { auto, fixture, isFunction, isRow, isText, list, num, parseJson, pick, raw, text } from "../../auto.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */
/** @typedef {import("../../procs.mjs").Graph} Graph */

const here = dirname(fileURLToPath(import.meta.url));
/** @type {(id: string) => unknown} */
const moduleRequire = createRequire(join(resolve(here, "../../../../../packages/dms-automation"), "package.json"));

/**
 * @typedef {{ insertOne: (document: Row) => Promise<unknown> }} ProceduresCollection
 * @typedef {{ connect: () => Promise<unknown>, close: () => Promise<unknown>, db: (name: string) => { collection: (name: string) => ProceduresCollection } }} MongoConnection
 * @typedef {{ MongoClient: new (url: string) => MongoConnection }} MongoDriver
 */

/**
 * @param {unknown} value A loaded module
 * @returns {value is MongoDriver} Whether it is the MongoDB driver
 */
function isMongo(value) {
  return isRow(value) && isFunction(value.MongoClient);
}

const BROKEN_ROUTER = /reading 'constructor'/;

/**
 * Calls a webhook on the API server and ends the journey as NOT VERIFIED when the API module cannot serve a route
 * registered with `RouteHandler.controller` (the published `@antelopejs/api` still reads `proto`), which is a gap of
 * the environment and not of the module under verification.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {{ method?: string, path: string, headers?: Record<string, string>, body?: string, origin?: "api" | "web" }} request The call
 * @returns {Promise<import("../../auto.mjs").Raw>} The answer
 */
export async function callWebhook(ctx, label, request) {
  const answer = await raw(ctx, label, { method: "POST", ...request });
  if (answer.status === 500 && BROKEN_ROUTER.test(answer.text)) {
    throw new Error(`NOT VERIFIED: the environment's API module cannot serve a webhook route (${answer.text.slice(0, 120)}); start the run with VERIFY_AUTO_API_PATH`);
  }
  return answer;
}

/**
 * A procedure with one webhook and a Log step that writes the trigger's `method`.
 *
 * @param {string} path The webhook path
 * @param {string} [method] The HTTP method, left out of the settings when absent
 * @param {string} [wired] The trigger output port wired into the Log message, none by default
 * @returns {Graph} The graph
 */
export function webhookGraph(path, method, wired) {
  const config = method === undefined ? { path } : { path, method };
  const nodes = [trigger("t", "webhook", config), action("log", "log.message", wired ? {} : { message: "webhook ran" })];
  return chain(nodes, wired ? [{ id: "d1", from: { node: "t", port: wired }, to: { node: "log", field: "message" } }] : []);
}

/**
 * A procedure whose only trigger is `typeId` with `config`, followed by a Log step.
 *
 * @param {string} typeId The trigger type
 * @param {Row} config Its settings
 * @param {string} [message] The Log message
 * @returns {Graph} The graph
 */
export function triggerGraph(typeId, config, message = "fired") {
  return chain([trigger("t", typeId, config), action("log", "log.message", { message })]);
}

/**
 * Creates a disabled draft and enables it.
 *
 * @param {Ctx} ctx The journey
 * @param {{ name?: string, graph: Graph }} spec The procedure
 * @returns {Promise<{ id: string, enabled: import("../../auto.mjs").Answer }>} Its id and the enable answer
 */
export async function enabledProcedure(ctx, spec) {
  const id = await createProcedure(ctx, spec);
  const enabled = await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
  return { id, enabled };
}

/**
 * Saves a graph on a procedure as the builder's Save does (a disabled draft by default), at its current revision.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @param {Graph} next The graph
 * @param {{ enabled?: boolean, name?: string }} [options] Whether it is saved enabled, and the name to keep
 * @returns {Promise<import("../../auto.mjs").Answer>} The answer
 */
export async function saveGraph(ctx, id, next, options = {}) {
  const current = await auto(ctx, "read the procedure to save", "GET", `/procedures/${id}`);
  return auto(ctx, "save the graph", "PUT", `/procedures/${id}`, {
    body: { name: options.name ?? text(current.body, "name"), description: text(current.body, "description"), enabled: options.enabled ?? false, graph: next, expectedRevision: pick(current.body, "revision") },
  });
}

/**
 * The validation of a graph as the builder's Problems dock asks it.
 *
 * @param {Ctx} ctx The journey
 * @param {Graph} draft The graph
 * @param {{ enabled?: boolean, procedureId?: string, name?: string }} [options] Whether it is validated as enabled
 * @returns {Promise<Row[]>} The issues
 */
export async function issuesOf(ctx, draft, options = {}) {
  const answer = await auto(ctx, "validate the graph", "POST", "/procedures/validate", { body: { graph: draft, enabled: options.enabled ?? false, procedureId: options.procedureId, name: options.name } });
  return list(answer.body, "issues");
}

/**
 * The issues as `severity code message` lines.
 *
 * @param {Row[]} issues The issues
 * @returns {string[]} The lines
 */
export function issueLines(issues) {
  return issues.map((issue) => `${text(issue, "severity")} ${text(issue, "code")} ${text(issue, "message")}`);
}

/**
 * The summary row of a procedure.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @returns {Promise<Row>} Its row of `GET /procedures/summary`, empty when absent
 */
export async function summaryOf(ctx, id) {
  const answer = await auto(ctx, "procedures summary", "GET", "/procedures/summary");
  return list(answer.body).find((row) => row.procedureId === id) ?? {};
}

/**
 * Polls the summary until the row satisfies `done`.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @param {(row: Row) => boolean} done The condition
 * @param {number} [timeoutMs] How long to wait
 * @returns {Promise<Row>} The last row read
 */
export async function summaryUntil(ctx, id, done, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let row = await summaryOf(ctx, id);
  while (!done(row) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    row = await summaryOf(ctx, id);
  }
  return row;
}

/**
 * Polls the procedure's runs until there are `count` of them.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @param {number} count How many runs to wait for
 * @param {number} [timeoutMs] How long to wait
 * @returns {Promise<Row[]>} The runs, newest first
 */
export async function runsUntil(ctx, id, count, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let runs = list((await auto(ctx, "the procedure's runs", "GET", `/procedures/${id}/runs`)).body);
  while (runs.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    runs = list((await auto(ctx, "the procedure's runs", "GET", `/procedures/${id}/runs`)).body);
  }
  return runs;
}

/**
 * A run's stored trigger payload, parsed.
 *
 * @param {Row} run A run as `GET /runs/:id` answers
 * @returns {unknown} The payload
 */
export function payloadOf(run) {
  const stored = run.triggerPayload;
  if (!isText(stored)) return stored;
  const parsed = parseJson(stored);
  return parsed === undefined ? stored : parsed;
}

/**
 * A run's stored trigger payload when it is an object.
 *
 * @param {Row} run A run as `GET /runs/:id` answers
 * @returns {Row} The payload, empty when the run holds none
 */
export function payloadRow(run) {
  const payload = payloadOf(run);
  return isRow(payload) ? payload : {};
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} runId The run
 * @returns {Promise<Row>} The run as `GET /runs/:id` answers
 */
export async function runDetail(ctx, runId) {
  const answer = await auto(ctx, "read the run", "GET", `/runs/${runId}`);
  return isRow(answer.body) ? answer.body : {};
}

/**
 * Fires every active fixture trigger on a topic.
 *
 * @param {Ctx} ctx The journey
 * @param {string} topic The topic
 * @param {unknown} payload The payload
 * @param {{ type?: string, force?: boolean }} [options] Restrict to a trigger type, or fire released handles too
 * @returns {Promise<number>} How many handles were fired
 */
export async function emit(ctx, topic, payload, options = {}) {
  const answer = await fixture(ctx, `emit on ${topic}`, "POST", "/emit", { topic, payload, ...options });
  return num(answer, "body", "emitted") ?? -1;
}

/**
 * The fixture ledger entries of one kind.
 *
 * @param {Row[]} entries The ledger entries
 * @param {string} kind The kind
 * @returns {Row[]} The entries of that kind
 */
export function ofKind(entries, kind) {
  return entries.filter((entry) => entry.kind === kind);
}

/**
 * Opens the run's database for direct reads and writes, which the API cannot make (a stored state the product would
 * refuse to save), and runs `body` with its procedures collection.
 *
 * @template T
 * @param {Ctx} ctx The journey
 * @param {(procedures: ProceduresCollection) => Promise<T>} body What to do
 * @returns {Promise<T>} What `body` returned
 */
export async function withProcedures(ctx, body) {
  const mongo = moduleRequire("mongodb");
  if (!isMongo(mongo)) throw new Error("the MongoDB driver did not load");
  const client = new mongo.MongoClient(String(ctx.state.mongoUrl));
  await client.connect();
  try {
    return await body(client.db(String(ctx.state.database)).collection("dms_automation__procedures"));
  } finally {
    await client.close();
  }
}

/**
 * Stores an enabled procedure the API would refuse to enable, as a document.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name Its name
 * @param {Graph} stored Its graph
 * @returns {Promise<string>} Its id
 */
export async function storeEnabled(ctx, name, stored) {
  const id = ctx.unique("stored").replace(/\s+/g, "-");
  const now = new Date();
  await withProcedures(ctx, (procedures) => procedures.insertOne({ _id: id, _instance: "dms-automation", name, description: "", enabled: true, graph: JSON.stringify(stored), version: 1, revision: 1, created_at: now, updated_at: now }));
  return id;
}

/**
 * A procedure whose only trigger is a schedule on `cron`, followed by a Log step.
 *
 * @param {string} cron The cron expression
 * @returns {Graph} The graph
 */
export function cronGraph(cron) {
  return triggerGraph("schedule.cron", { cron });
}

/**
 * A procedure whose trigger is a fixture event on `topic` and whose step ticks `key` in the ledger.
 *
 * @param {string} topic The topic
 * @param {string} [key] The tick counter key
 * @param {string} [typeId] The trigger type
 * @returns {Graph} The graph
 */
export function eventGraph(topic, key = "fired", typeId = "verify.event") {
  return chain([trigger("t", typeId, { topic }), action("tick", "verify.tick", { key })]);
}

export { graph, tedge };
