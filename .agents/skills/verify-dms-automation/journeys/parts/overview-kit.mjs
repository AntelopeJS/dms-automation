import { createRequire } from "node:module";
import { join } from "node:path";
import { auto, check, isFunction, isRow, text } from "../../auto.mjs";
import { ariaSnapshot, innerText } from "./overview-page.mjs";
import { action, chain, createEnabled, createProcedure, manualLog, runNow, trigger } from "../../procs.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Tab} Tab */
/** @typedef {import("../../auto.mjs").Check} Check */
/** @typedef {import("../../auto.mjs").Row} Row */
/**
 * @typedef {{ updateOne: (filter: Row, update: Row) => Promise<unknown> }} Collection
 * @typedef {{ collection: (name: string) => Collection }} Database
 * @typedef {{ connect: () => Promise<unknown>, close: () => Promise<unknown>, db: (name: string) => Database }} MongoConnection
 * @typedef {{ MongoClient: new (url: string) => MongoConnection }} MongoDriver
 */

/**
 * @param {unknown} value A loaded module
 * @returns {value is MongoDriver} Whether it is the MongoDB driver
 */
function isMongo(value) {
  return isRow(value) && isFunction(value.MongoClient);
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** The overview as the platform owner opens it. */
export const OVERVIEW = "/modules/automation/overview";

/**
 * Runs `use` with a connection to the journey's database.
 *
 * @template T
 * @param {Ctx} ctx The journey
 * @param {(database: Database) => Promise<T>} use What to do with the database
 * @returns {Promise<T>} What `use` returned
 */
export async function withDatabase(ctx, use) {
  /** @type {(id: string) => unknown} */
  const load = createRequire(join(String(ctx.state.playground), "package.json"));
  const mongo = load("mongodb");
  if (!isMongo(mongo)) throw new Error("the MongoDB driver did not load");
  const client = new mongo.MongoClient(String(ctx.state.mongoUrl));
  await client.connect();
  try {
    return await use(client.db(String(ctx.state.database)));
  } finally {
    await client.close();
  }
}

/**
 * Moves a stored run in time, as if it had started `startedAt` and lasted `durationMs`.
 *
 * @param {Ctx} ctx The journey
 * @param {string} runId The run
 * @param {number} startedAt When it started, in epoch milliseconds
 * @param {number} [durationMs] How long it lasted
 * @returns {Promise<void>}
 */
export async function backdate(ctx, runId, startedAt, durationMs = 5) {
  await withDatabase(ctx, async (database) => {
    await database
      .collection("dms_automation__procedure_runs")
      .updateOne({ _id: runId }, { $set: { startedAt: new Date(startedAt), endedAt: new Date(startedAt + durationMs), durationMs } });
  });
}

/**
 * Sets fields of a stored procedure that no route sets.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @param {Record<string, unknown>} fields The fields
 * @returns {Promise<void>}
 */
export async function patchProcedure(ctx, id, fields) {
  await withDatabase(ctx, async (database) => {
    await database.collection("dms_automation__procedures").updateOne({ _id: id }, { $set: fields });
  });
}

/**
 * An enabled procedure whose runs all fail at the Fixture failure step.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name Its name
 * @param {number} [times] How many runs
 * @param {string} [message] The error
 * @returns {Promise<{ id: string, runIds: string[] }>} The procedure and its runs, oldest first
 */
export async function failing(ctx, name, times = 1, message = "boom") {
  const { id } = await createEnabled(ctx, { name, graph: chain([trigger("t"), action("f", "verify.fail", { message })]) });
  /** @type {string[]} */
  const runIds = [];
  for (let index = 0; index < times; index += 1) runIds.push((await runNow(ctx, id)).runId);
  return { id, runIds };
}

/**
 * An enabled procedure that failed once and succeeded since: degraded.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name Its name
 * @returns {Promise<{ id: string, failedRunId: string, okRunId: string }>} The procedure and its two runs
 */
export async function degraded(ctx, name) {
  const key = ctx.unique("flaky");
  const { id } = await createEnabled(ctx, { name, graph: chain([trigger("t"), action("f", "verify.flaky", { key, failTimes: 1 })]) });
  const failed = await runNow(ctx, id);
  const ok = await runNow(ctx, id);
  return { id, failedRunId: failed.runId, okRunId: ok.runId };
}

/**
 * An enabled procedure that ran once, fine.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name Its name
 * @returns {Promise<{ id: string, runId: string }>} The procedure and its run
 */
export async function healthy(ctx, name) {
  const { id } = await createEnabled(ctx, { name, graph: manualLog("fine") });
  return { id, runId: (await runNow(ctx, id)).runId };
}

/**
 * Pauses a procedure.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @returns {Promise<void>}
 */
export async function pause(ctx, id) {
  await auto(ctx, "pause", "PUT", `/procedures/${id}/enabled`, { body: { enabled: false } });
}

/**
 * An enabled procedure whose trigger cannot arm: failing without a run.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name Its name
 * @returns {Promise<string>} Its id
 */
export async function unarmed(ctx, name) {
  return (await createEnabled(ctx, { name, graph: chain([trigger("t", "verify.bad-arm")]) })).id;
}

/**
 * A disabled draft with a Manual trigger.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name Its name
 * @returns {Promise<string>} Its id
 */
export async function draft(ctx, name) {
  return createProcedure(ctx, { name, graph: manualLog("draft") });
}

/**
 * The page's text on one line.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The visible text, spaces collapsed
 */
export async function bodyText(tab) {
  const body = await innerText(tab.page.locator("body")).catch(() => "");
  return body.replace(/\s+/g, " ").trim();
}

/**
 * A check that the page's visible text holds (or, with `not`, never holds) a text exactly, waiting for the page to
 * read its data.
 *
 * @param {Tab} tab The tab
 * @param {string} name What is checked
 * @param {string} expected The text, as the page shows it
 * @param {{ not?: boolean, timeoutMs?: number }} [options] Whether it must be absent, and how long to wait
 * @returns {Promise<Check>} The check
 */
export async function shows(tab, name, expected, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 20_000);
  let seen = "";
  let pass = false;
  do {
    seen = await bodyText(tab);
    pass = seen.includes(expected) !== Boolean(options.not);
    if (pass) break;
    await tab.page.waitForTimeout(400);
  } while (Date.now() < deadline);
  return check(`${name}: page ${options.not ? "does not show" : "shows"} "${expected}"`, pass, seen.slice(0, 1500));
}

/**
 * The ARIA snapshot of the first element a selector finds, waiting for it.
 *
 * @param {Tab} tab The tab
 * @param {string} selector A Playwright selector
 * @param {number} [timeoutMs] How long to wait
 * @returns {Promise<string>} The snapshot, empty when nothing was found
 */
export async function aria(tab, selector, timeoutMs = 20_000) {
  const locator = tab.page.locator(selector).first();
  const found = await locator.waitFor({ state: "attached", timeout: timeoutMs }).then(
    () => true,
    () => false,
  );
  return found ? ariaSnapshot(locator).catch(() => "") : "";
}

/**
 * The Needs attention list's row of a procedure, read as its ARIA snapshot.
 *
 * @param {Tab} tab The tab
 * @param {string} name The procedure's name
 * @param {number} [timeoutMs] How long to wait
 * @returns {Promise<string>} The row's snapshot
 */
export async function attentionRow(tab, name, timeoutMs = 20_000) {
  return aria(tab, `li:has(span.truncate:text-is(${JSON.stringify(name)}))`, timeoutMs);
}

/**
 * Waits until the ARIA snapshot of a selector satisfies a predicate.
 *
 * @param {Tab} tab The tab
 * @param {string} selector A Playwright selector
 * @param {(snapshot: string) => boolean} done Whether the snapshot is the awaited one
 * @param {number} [timeoutMs] How long to wait
 * @returns {Promise<string>} The last snapshot
 */
export async function ariaUntil(tab, selector, done, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await aria(tab, selector, 2_000);
  while (!done(snapshot) && Date.now() < deadline) {
    await tab.page.waitForTimeout(400);
    snapshot = await aria(tab, selector, 2_000);
  }
  return snapshot;
}

/**
 * Opens a page and waits for the dashboard to hydrate it.
 *
 * @param {Tab} tab The tab
 * @param {string} path The path
 * @returns {Promise<void>}
 */
export async function open(tab, path) {
  await tab.goto(path);
  await tab.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
}

/**
 * A fixed hour boundary at or before now, so bucket maths do not depend on when a journey runs.
 *
 * @returns {number} Epoch milliseconds on the hour
 */
export function thisHour() {
  return Math.floor(Date.now() / HOUR) * HOUR;
}

/**
 * The stats query of a window.
 *
 * @param {number} from Epoch milliseconds
 * @param {number} to Epoch milliseconds
 * @param {{ compareFrom?: number, compareTo?: number, comparison?: string, preset?: string }} [more] The compared window and more
 * @returns {string} The query string, with its `?`
 */
export function windowQuery(from, to, more = {}) {
  const query = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
  if (more.compareFrom !== undefined) query.set("compareFrom", new Date(more.compareFrom).toISOString());
  if (more.compareTo !== undefined) query.set("compareTo", new Date(more.compareTo).toISOString());
  if (more.comparison) query.set("comparison", more.comparison);
  if (more.preset) query.set("preset", more.preset);
  return `?${query}`;
}

/**
 * @param {unknown} value A JSON value
 * @param {...string} path Field names
 * @returns {string} The field as text
 */
export function field(value, ...path) {
  return text(value, ...path);
}

/**
 * Moves several stored runs in time over one connection.
 *
 * @param {Ctx} ctx The journey
 * @param {{ runId: string, startedAt: number, durationMs: number }[]} moves The runs and where they go
 * @returns {Promise<void>}
 */
export async function backdateMany(ctx, moves) {
  await withDatabase(ctx, async (database) => {
    const runs = database.collection("dms_automation__procedure_runs");
    for (const move of moves) {
      await runs.updateOne({ _id: move.runId }, { $set: { startedAt: new Date(move.startedAt), endedAt: new Date(move.startedAt + move.durationMs), durationMs: move.durationMs } });
    }
  });
}

/**
 * Makes runs of one succeeding and one failing procedure, then places each in time.
 *
 * @param {Ctx} ctx The journey
 * @param {{ at: number, durationMs: number, failed?: boolean }[]} specs The runs to make, in any order
 * @returns {Promise<{ okId: string, failId: string, runIds: string[] }>} The two procedures and the run of each spec
 */
export async function seedRuns(ctx, specs) {
  const ok = await createEnabled(ctx, { name: ctx.unique("Succeeds"), graph: manualLog("fine") });
  const bad = await createEnabled(ctx, { name: ctx.unique("Fails"), graph: chain([trigger("t"), action("f", "verify.fail", { message: "seeded" })]) });
  /** @type {string[]} */
  const runIds = [];
  for (const spec of specs) runIds.push((await runNow(ctx, spec.failed ? bad.id : ok.id)).runId);
  await backdateMany(ctx, specs.map((spec, index) => ({ runId: runIds[index] ?? "", startedAt: spec.at, durationMs: spec.durationMs })));
  return { okId: ok.id, failId: bad.id, runIds };
}
