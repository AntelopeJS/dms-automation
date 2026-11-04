import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { auto, isFunction, isRow, list, num, pick, text } from "../../auto.mjs";
import { action, chain, createEnabled, runNow, trigger } from "../../procs.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Tab} Tab */
/** @typedef {import("../../auto.mjs").Row} Row */

/**
 * @typedef {{ insertMany: (documents: Row[]) => Promise<unknown>, findOne: (filter: Row) => Promise<Row | null>, updateOne: (filter: Row, update: Row) => Promise<unknown>, find: (filter: Row, options: Row) => { toArray: () => Promise<Row[]> } }} RunsCollection
 * @typedef {{ connect: () => Promise<unknown>, close: () => Promise<unknown>, db: (name: string) => { collection: (name: string) => RunsCollection } }} MongoConnection
 * @typedef {{ MongoClient: new (url: string) => MongoConnection }} MongoDriver
 */

const RUNS_COLLECTION = "dms_automation__procedure_runs";
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
export { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE };

/**
 * @param {unknown} value A loaded module
 * @returns {value is MongoDriver} Whether it is the MongoDB driver
 */
function isMongo(value) {
  return isRow(value) && isFunction(value.MongoClient);
}

/**
 * @param {string} left A text
 * @param {string} right Another text
 * @returns {number} Their order, for `sort`
 */
export function alphabetical(left, right) {
  return left.localeCompare(right);
}

/**
 * The length of an array field of a JSON answer, whatever its elements are.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {number} The length, -1 when the field is not an array
 */
export function size(value, ...path) {
  const found = pick(value, ...path);
  return Array.isArray(found) ? found.length : -1;
}

/**
 * Runs `body` with the run's database, to write run documents the product cannot be made to write by waiting
 * (old runs, a run stored before a name was marked sensitive, a test whose draft was not kept).
 *
 * @template T
 * @param {Ctx} ctx The journey
 * @param {(runs: RunsCollection) => Promise<T>} body What to do with the runs collection
 * @returns {Promise<T>} What `body` returns
 */
export async function withRuns(ctx, body) {
  const base = `${String(ctx.state.runPlayground)}/.antelope/cache/@antelopejs/mongodb/node_modules/.pnpm`;
  const directory = readdirSync(base).find((entry) => entry.startsWith("mongodb@")) ?? "";
  /** @type {(id: string) => unknown} */
  const load = createRequire(`${base}/${directory}/node_modules/mongodb/package.json`);
  const mongo = load("mongodb");
  if (!isMongo(mongo)) throw new Error("the MongoDB driver did not load");
  const client = new mongo.MongoClient(String(ctx.state.mongoUrl));
  await client.connect();
  try {
    return await body(client.db(String(ctx.state.database)).collection(RUNS_COLLECTION));
  } finally {
    await client.close();
  }
}

/**
 * The log of a run of steps run one after the other, shaped like the one the executor writes.
 *
 * @param {{ id: string, kind?: string, durationMs: number, error?: string }[]} steps The steps in order; a step with `error` fails and ends the run
 * @returns {{ fires: Row[], entries: Row[] }} The log
 */
export function logOf(steps) {
  const fireId = `f-${randomUUID().slice(0, 8)}`;
  let seq = 1;
  let ts = 0;
  /** @type {Row[]} */
  const entries = [{ fireId, ts, seq, level: "info", source: "exec", nodeId: null, nodeKind: null, message: "run started" }];
  for (const step of steps) {
    const kind = step.kind ?? "action";
    seq += 1;
    entries.push({ fireId, ts, seq, level: "info", source: "exec", nodeId: step.id, nodeKind: kind, message: "executing" });
    ts += step.durationMs;
    seq += 1;
    if (step.error !== undefined) {
      entries.push({ fireId, ts, seq, level: "error", source: "exec", nodeId: step.id, nodeKind: kind, message: step.error, value: { durationMs: step.durationMs, inputs: {} } });
      break;
    }
    entries.push({ fireId, ts, seq, level: "info", source: "exec", nodeId: step.id, nodeKind: kind, message: "executed", value: { durationMs: step.durationMs, inputs: {}, output: { type: "object", value: {} } } });
  }
  return { fires: [{ id: fireId, ts: 0, seq: 0, parentFireId: null, sourceNodeId: "t", port: null, closedAt: ts }], entries };
}

/**
 * A run document as the module stores it.
 *
 * @param {{ procedureId: string, procedureName: string, startedAt: Date, durationMs?: number, status?: string, kind?: string, errorMessage?: string, triggerNodeId?: string, triggerPayload?: unknown, steps?: Parameters<typeof logOf>[0], procedureVersion?: number, triggerType?: string, failedNodeId?: string, id?: string, failedStep?: Row, triggerSummary?: Row, rerunOf?: string, graphSnapshot?: string }} spec What the run is
 * @returns {Row} The document
 */
export function runDocument(spec) {
  const durationMs = spec.durationMs ?? 5;
  const triggerType = spec.triggerType ?? "manual";
  const triggerNodeId = spec.triggerNodeId ?? "t";
  /** @type {Row} */
  const doc = {
    _id: spec.id ?? randomUUID(),
    procedureId: spec.procedureId,
    procedureName: spec.procedureName,
    startedAt: spec.startedAt,
    endedAt: new Date(spec.startedAt.getTime() + durationMs),
    status: spec.status ?? "ok",
    triggerNodeId,
    triggerPayload: JSON.stringify(spec.triggerPayload ?? {}),
    logs: logOf(spec.steps ?? []),
    kind: spec.kind ?? "run",
    instanceId: "00000000-seeded-run",
    stepNames: {},
    durationMs,
    triggerSummary: { nodeId: triggerNodeId, typeId: triggerType, typeName: "$dms_automation.types.manual.name" },
    triggerType,
    _instance: "dms-automation",
  };
  return Object.assign(doc, optionalFields(spec), failureFields(spec));
}

/**
 * @param {Parameters<typeof runDocument>[0]} spec What the run is
 * @returns {Row} The fields a spec sets only when it gives them
 */
function optionalFields(spec) {
  /** @type {Row} */
  const extra = {};
  if (spec.errorMessage !== undefined) extra.errorMessage = spec.errorMessage;
  if (spec.kind !== "test") extra.procedureVersion = spec.procedureVersion ?? 1;
  if (spec.triggerSummary) extra.triggerSummary = spec.triggerSummary;
  if (spec.rerunOf) extra.rerunOf = spec.rerunOf;
  if (spec.graphSnapshot) extra.graphSnapshot = spec.graphSnapshot;
  return extra;
}

/**
 * @param {Parameters<typeof runDocument>[0]} spec What the run is
 * @returns {Row} The failure fields, empty when no step fails
 */
function failureFields(spec) {
  const failedStep = (spec.steps ?? []).find((step) => step.error !== undefined);
  if (!failedStep) return {};
  return {
    failedStep: spec.failedStep ?? { nodeId: failedStep.id, kind: "action", label: failedStep.id },
    failedNodeId: spec.failedNodeId ?? failedStep.id,
    errorMessage: spec.errorMessage ?? failedStep.error,
  };
}

/**
 * Stores run documents.
 *
 * @param {Ctx} ctx The journey
 * @param {Row[]} docs The documents
 * @returns {Promise<void>}
 */
export async function insertRuns(ctx, docs) {
  await withRuns(ctx, (runs) => runs.insertMany(docs));
}

/**
 * The run document as it is stored.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The run id
 * @returns {Promise<Row | null>} The document, null when it is gone
 */
export async function storedRun(ctx, id) {
  return await withRuns(ctx, (runs) => runs.findOne({ _id: id }));
}

/**
 * The ids of the runs the database holds.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<string[]>} The ids, oldest run first
 */
export async function storedRunIds(ctx) {
  const rows = await withRuns(ctx, (runs) => runs.find({}, { projection: { _id: 1 }, sort: { startedAt: 1 } }).toArray());
  return rows.map((row) => String(row._id));
}

/**
 * Reads the run history table the way the Run history page does.
 *
 * @param {Ctx} ctx The journey
 * @param {Record<string, string | number>} [query] The query: `limit`, `offset`, `sortKey`, `sortDirection`, `search`, `filter_<field>=<mode>:<value>`
 * @returns {Promise<{ rows: Row[], total: number, status: number | null }>} The page of rows and the total
 */
export async function runTable(ctx, query = {}) {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const answer = await auto(ctx, `list runs ${params.toString()}`, "GET", `/tables/runs/list?${params.toString()}`);
  const total = num(answer.body, "total") ?? -1;
  return { rows: list(answer.body, "results"), total, status: answer.status };
}

/**
 * The ids of table rows.
 *
 * @param {Row[]} rows The rows
 * @returns {string[]} Their ids
 */
export function idsOf(rows) {
  return rows.map((row) => text(row, "_id"));
}

/**
 * A copy of a read procedure's graph with the `message` of one node's config changed.
 *
 * @param {unknown} saved The procedure as `GET /procedures/:id` answers it
 * @param {string} nodeId The node
 * @param {string} message The new message
 * @returns {unknown} The graph
 */
export function graphWithMessage(saved, nodeId, message) {
  const graph = structuredClone(pick(saved, "graph"));
  const config = pick(list(graph, "nodes").find((node) => node.id === nodeId), "config");
  if (isRow(config)) config.message = message;
  return graph;
}

/**
 * Saves a graph over a procedure that was just read, enabled and without a description.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} id The procedure
 * @param {unknown} saved The procedure as it was read
 * @param {unknown} graph The graph to save
 * @returns {ReturnType<typeof auto>} The answer
 */
export function saveGraph(ctx, label, id, saved, graph) {
  return auto(ctx, label, "PUT", `/procedures/${id}`, { body: { name: text(saved, "name"), description: "", enabled: true, graph, expectedRevision: pick(saved, "revision") } });
}

/**
 * A procedure that logs two messages, enabled.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The name
 * @returns {Promise<string>} The id
 */
export async function twoStepProcedure(ctx, name) {
  const { id } = await createEnabled(ctx, { name, graph: chain([trigger("t"), action("a", "log.message", { message: "step one" }), action("b", "log.message", { message: "step two" })]) });
  return id;
}

/**
 * Runs a procedure now a given number of times, a few milliseconds apart so each start differs.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @param {number} count How many runs
 * @returns {Promise<string[]>} The run ids, oldest first
 */
export async function runMany(ctx, id, count) {
  /** @type {string[]} */
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    ids.push((await runNow(ctx, id, { n: i })).runId);
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  return ids;
}

/**
 * The text of the page.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The visible text
 */
export async function bodyText(tab) {
  return await tab.page.locator("body").evaluate((element) => element.innerText);
}

/**
 * The text of the dialog, the drawer of a run when one is open.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The visible text of the first dialog
 */
export async function dialogText(tab) {
  return await tab.page.getByRole("dialog").first().evaluate((element) => element.innerText);
}

/**
 * Waits until the page text matches or the time is up, and returns the last text read.
 *
 * @param {Tab} tab The tab
 * @param {RegExp} pattern What to wait for
 * @param {number} [timeoutMs] How long
 * @returns {Promise<string>} The text
 */
export async function textWhen(tab, pattern, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let current = await bodyText(tab);
  while (!pattern.test(current) && Date.now() < deadline) {
    await tab.page.waitForTimeout(300);
    current = await bodyText(tab);
  }
  return current;
}

/**
 * @param {Tab} tab The tab
 * @returns {Promise<string[][]>} The cell texts of every body row of the tables, whitespace collapsed
 */
async function cellsOfRows(tab) {
  return await tab.page.evaluate(() =>
    Array.from(document.querySelectorAll("table tbody tr")).map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.innerText.replace(/\s+/g, " ").trim())),
  );
}

/**
 * The cells of the rows of the run history table, as the page draws them.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[][]>} One list of cell texts per run row (group headings left out)
 */
export async function tableRows(tab) {
  const rows = await cellsOfRows(tab);
  return rows.filter((cells) => cells.length > 2);
}

/**
 * The group heading rows of the run history table.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} The headings, in page order
 */
export async function groupHeadings(tab) {
  const rows = await cellsOfRows(tab);
  return rows.filter((cells) => cells.length === 1).map((cells) => cells[0] ?? "");
}

/**
 * Opens a page of the automation module as the administrator and waits for the server render to hydrate.
 *
 * @param {Ctx} ctx The journey
 * @param {string} path The path, with its query
 * @param {RegExp} ready Text the page shows once loaded
 * @returns {Promise<{ tab: Tab, text: string }>} The tab and the text once ready
 */
export async function openPage(ctx, path, ready) {
  const tab = await ctx.tab("admin");
  await tab.signIn("admin");
  await tab.goto(path);
  const current = await textWhen(tab, ready);
  return { tab, text: current };
}
