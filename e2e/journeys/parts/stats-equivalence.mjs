import { auto, check, isNumber, isRow, list, pick, text } from "../../auto.mjs";
import { windowQuery } from "./overview-kit.mjs";
import { seedFixture, windowsOf } from "./stats-fixture.mjs";
import { MS_PER_DAY, MS_PER_HOUR, kpiPayload, timeOf } from "./stats-reference-health.mjs";
import { healthBanner, libraryUsage, procedureSummary, proceduresSummary, sortRows } from "./stats-reference-rows.mjs";
import { attentionRows, healthHero, procedureCounts, recentRunItems, runsPerDayChart, statsContext, triggerCounts } from "./stats-reference.mjs";
import { readStored } from "./stats-stored.mjs";

/**
 * @typedef {import("../../auto.mjs").Ctx} Ctx
 * @typedef {import("../../auto.mjs").Row} Row
 * @typedef {import("../../auto.mjs").Check} Check
 * @typedef {import("./stats-stored.mjs").Stored} Stored
 * @typedef {{ from: number, to: number, compareFrom?: number, compareTo?: number }} Window
 * @typedef {{ from: Date, to: Date, compareFrom?: Date, compareTo?: Date }} DatedWindow
 * @typedef {{ label: string, path: string, expected: unknown, read?: (body: unknown) => unknown }} Call
 */

const STATS = "/stats";
const KPI_METRICS = ["runs", "success-rate", "failed", "duration-p95"];
const STATES = ["failing", "degraded", "healthy", "paused", "draft"];
const LINKS = { runsUrl: "/modules/automation/runs", traceUrl: "/modules/automation/trace", proceduresUrl: "/modules/automation/procedures" };
const RUNS_PERIOD_SCOPE = "automation-runs";
const SLACK_MS = 60_000;
const OVERVIEW_READS = 10;

/**
 * @param {unknown} value A JSON value
 * @returns {unknown} The value with its object keys sorted and `undefined` fields dropped
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRow(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, field]) => [key, canonical(field)]),
  );
}

/**
 * @param {unknown} actual What the module answered
 * @param {unknown} expected What the reference computed
 * @param {string} [path] Where in the answer
 * @returns {string | undefined} The first difference, undefined when they are equal
 */
function firstDifference(actual, expected, path = "$") {
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return `${path}: ${actual.length} items, expected ${expected.length}`;
    for (let index = 0; index < actual.length; index += 1) {
      const found = firstDifference(actual[index], expected[index], `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (isRow(actual) && isRow(expected)) {
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      const found = firstDifference(actual[key], expected[key], `${path}.${key}`);
      if (found) return found;
    }
    return undefined;
  }
  return Object.is(actual, expected) ? undefined : `${path}: ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
}

/**
 * Orders the items that share a date by their id: the old answer leaves them in the order the database returned them.
 *
 * @param {Row[]} items Items sorted by date
 * @param {string} dateKey The field holding the date
 * @param {string} idKey The field holding the id
 * @returns {Row[]} The same items, each group of one date sorted by id
 */
function tiesAsSets(items, dateKey, idKey) {
  /** @type {Row[]} */
  const out = [];
  for (let start = 0; start < items.length; ) {
    let end = start;
    while (end < items.length && items[end]?.[dateKey] === items[start]?.[dateKey]) end += 1;
    out.push(...items.slice(start, end).sort((a, b) => text(a, idKey).localeCompare(text(b, idKey))));
    start = end;
  }
  return out;
}

/**
 * @param {unknown} row A procedures list row
 * @returns {unknown} The row with its strip of last runs read as sets
 */
function rowAsSets(row) {
  return isRow(row) && Array.isArray(row.lastRuns) ? { ...row, lastRuns: tiesAsSets(list(row, "lastRuns"), "startedAt", "runId") } : row;
}

/**
 * @param {unknown} body A procedures list answer
 * @returns {unknown} The answer with every strip read as a set
 */
function pageAsSets(body) {
  return isRow(body) && Array.isArray(body.results) ? { ...body, results: list(body, "results").map(rowAsSets) } : body;
}

/**
 * @param {unknown} body A procedures summary answer
 * @returns {unknown} The answer with every strip read as a set
 */
function summaryAsSets(body) {
  return Array.isArray(body) ? list(body).map(rowAsSets) : body;
}

/**
 * @param {unknown} body A recent runs answer
 * @returns {unknown} The answer with the runs of one start read as a set
 */
function feedAsSets(body) {
  return isRow(body) && Array.isArray(body.items) ? { ...body, items: tiesAsSets(list(body, "items"), "date", "id") } : body;
}

/**
 * @param {Stored} stored What the database stores
 * @param {number} now The time of the read
 * @param {Date} [earliest] How far back the answer reads
 * @returns {ReturnType<typeof statsContext>} The reference's context
 */
function contextOf(stored, now, earliest) {
  return statsContext({ procedures: stored.procedures, runs: stored.runs, names: stored.names, now: new Date(now), earliest });
}

/**
 * @param {Window} window A window in epoch milliseconds
 * @returns {DatedWindow} The window with dates
 */
function datesOf(window) {
  /** @type {DatedWindow} */
  const out = { from: new Date(window.from), to: new Date(window.to) };
  if (window.compareFrom !== undefined && window.compareTo !== undefined) {
    out.compareFrom = new Date(window.compareFrom);
    out.compareTo = new Date(window.compareTo);
  }
  return out;
}

/**
 * The compared window the module keeps: none when no stored run, a test run included, started before its start.
 *
 * @param {Stored} stored What the database stores
 * @param {DatedWindow} window The window as asked
 * @returns {DatedWindow} The window as the module keeps it
 */
function keptComparison(stored, window) {
  if (!window.compareFrom) return window;
  const compareFrom = window.compareFrom.getTime();
  return stored.runs.some((run) => timeOf(run.startedAt) < compareFrom) ? window : { from: window.from, to: window.to };
}

/**
 * @param {DatedWindow} window A window
 * @returns {Date} The earliest date it reaches back to
 */
function earliestOf(window) {
  return window.compareFrom && window.compareFrom < window.from ? window.compareFrom : window.from;
}

/**
 * @param {Record<string, Window>} windows The windows by name
 * @param {string} name A window name
 * @returns {Window} The window
 * @throws When there is none
 */
function windowNamed(windows, name) {
  const found = windows[name];
  if (!found) throw new Error(`no window ${name}`);
  return found;
}

/**
 * The calls that ask for one window, with the whole answer the reference computes for each.
 *
 * @param {Stored} stored What the database stores
 * @param {string} name The window's name
 * @param {Window} window The window
 * @param {number} now The time of the read
 * @returns {Call[]} The calls
 */
function windowCalls(stored, name, window, now) {
  const asked = datesOf(window);
  const plain = { from: asked.from, to: asked.to };
  const plainRuns = contextOf(stored, now, plain.from).runs;
  const query = windowQuery(window.from, window.to);
  const preset = name === "weekCompared" ? "last-7-days" : undefined;
  const hero = healthHero(contextOf(stored, now, plain.from), plain);
  const links = { ...LINKS, runsPeriod: preset ? { scope: RUNS_PERIOD_SCOPE, preset } : undefined };
  /** @type {Call[]} */
  const calls = [
    { label: `health ${name}`, path: `${STATS}/health${windowQuery(window.from, window.to, preset ? { preset } : {})}`, expected: healthBanner(hero, links) },
    { label: `attention ${name}`, path: `${STATS}/attention${query}`, expected: attentionRows(contextOf(stored, now, plain.from), plain.from) },
  ];
  const compared = keptComparison(stored, asked);
  const ctx = contextOf(stored, now, earliestOf(compared));
  const comparedQuery = windowQuery(window.from, window.to, { compareFrom: window.compareFrom, compareTo: window.compareTo });
  for (const metric of KPI_METRICS) {
    calls.push({ label: `${metric} ${name}`, path: `${STATS}/kpi/${metric}${comparedQuery}`, expected: kpiPayload(metric, ctx.runs, compared) });
    calls.push({ label: `${metric} ${name} without a compared window`, path: `${STATS}/kpi/${metric}${query}`, expected: kpiPayload(metric, plainRuns, plain) });
  }
  const grain = asked.to.getTime() - asked.from.getTime() <= 2 * MS_PER_DAY ? "hour" : "day";
  calls.push({ label: `runs per ${grain} ${name}`, path: `${STATS}/runs-per-day${comparedQuery}`, expected: runsPerDayChart(ctx, compared) });
  calls.push({ label: `runs per ${grain} ${name} without a compared window`, path: `${STATS}/runs-per-day${query}`, expected: runsPerDayChart(contextOf(stored, now, plain.from), plain) });
  return calls;
}

/**
 * The calls that read the procedures and no window: the lists, the counts, the feed and the Library.
 *
 * @param {Stored} stored What the database stores
 * @param {Record<string, string>} ids The procedures by key
 * @param {number} now The time of the read
 * @returns {Call[]} The calls
 */
function listCalls(stored, ids, now) {
  const base = contextOf(stored, now);
  const rows = proceduresSummary(base);
  /** @type {Call[]} */
  const calls = [
    { label: "recent runs", path: `${STATS}/recent-runs`, expected: feedAsSets({ items: recentRunItems(base, LINKS.traceUrl) }), read: feedAsSets },
    { label: "procedure counts", path: `${STATS}/procedures`, expected: { items: procedureCounts(base, LINKS.proceduresUrl) } },
    { label: "trigger counts", path: `${STATS}/triggers`, expected: { items: triggerCounts(base) } },
    { label: "procedures summary", path: "/procedures/summary", expected: summaryAsSets(rows), read: summaryAsSets },
  ];
  for (const [sortKey, sortDirection] of [[undefined, undefined], ["runs", "desc"], ["successRate", "asc"], ["avgDurationMs", "desc"], ["lastRunAt", "desc"], ["name", "asc"], ["status", "desc"]]) {
    const sorted = sortRows(rows, sortKey, sortDirection);
    const query = new URLSearchParams({ limit: "7", offset: "3" });
    if (sortKey) {
      query.set("sortKey", sortKey);
      query.set("sortDirection", sortDirection ?? "asc");
    }
    calls.push({ label: `procedures list sorted by ${sortKey ?? "state"}`, path: `/tables/procedures/list?${query}`, expected: pageAsSets({ results: sorted.slice(3, 10), total: sorted.length, offset: 3, limit: 7 }), read: pageAsSets });
  }
  for (const status of STATES) {
    calls.push({ label: `procedures count ${status}`, path: `/tables/procedures/count?filter_status=${status}`, expected: { total: rows.filter((row) => row.status === status).length } });
  }
  for (const key of ["longStreak", "twoTriggers", "cut", "unarmed", "draft"]) {
    const id = ids[key] ?? "";
    calls.push({ label: `procedure ${key}`, path: `/tables/procedures/get?id=${id}`, expected: rowAsSets(procedureSummary(base, id)), read: rowAsSets });
  }
  for (const catalog of ["triggers", "actions"]) {
    calls.push({ label: `library usage of ${catalog}`, path: `/library/usage/${catalog}`, expected: libraryUsage(base, catalog) });
  }
  return calls;
}

/**
 * Every call of the journey with the whole answer the reference computes for it.
 *
 * @param {Stored} stored What the database stores
 * @param {Record<string, Window>} windows The windows by name
 * @param {Record<string, string>} ids The procedures by key
 * @param {number} now The time of the read
 * @returns {Call[]} The calls
 */
function expectations(stored, windows, ids, now) {
  const calls = Object.entries(windows).flatMap(([name, window]) => windowCalls(stored, name, window, now));
  const week = windowNamed(windows, "weekCompared");
  const none = windowQuery(week.from, week.to, { compareFrom: week.compareFrom, compareTo: week.compareTo, comparison: "none" });
  const plain = datesOf({ from: week.from, to: week.to });
  calls.push({ label: "runs, comparison none", path: `${STATS}/kpi/runs${none}`, expected: kpiPayload("runs", contextOf(stored, now, plain.from).runs, plain) });
  return [...calls, ...listCalls(stored, ids, now)];
}

/**
 * @param {Call} call What was asked and what to expect
 * @param {{ status: number | null, body: unknown }} answer What the module answered
 * @returns {Check} Whether the whole answer is the reference's
 */
function matches(call, answer) {
  const found = answer.status === 200 ? firstDifference(canonical(call.read ? call.read(answer.body) : answer.body), canonical(call.expected)) : `status ${answer.status}`;
  return check(`${call.label}: the whole answer is the reference's`, found === undefined, found ?? "equal");
}

/**
 * The reference's answers over the fixture, to say what the fixture exercises.
 *
 * @param {Stored} stored What the database stores
 * @param {Record<string, Window>} windows The windows by name
 * @param {number} now The time of the read
 * @returns {Check[]} Checks that the fixture holds each case
 */
function fixtureCases(stored, windows, now) {
  const base = contextOf(stored, now);
  const rows = proceduresSummary(base);
  const byName = (/** @type {string} */ part) => rows.find((row) => text(row, "name").includes(part));
  const kept = (/** @type {string} */ name) => keptComparison(stored, datesOf(windowNamed(windows, name)));
  const deltas = KPI_METRICS.flatMap((metric) =>
    Object.keys(windows).map((name) => {
      const window = kept(name);
      return pick(kpiPayload(metric, contextOf(stored, now, earliestOf(window)).runs, window), "delta");
    }),
  );
  const mismatched = kept("mismatchedCompared");
  const chart = runsPerDayChart(contextOf(stored, now, earliestOf(mismatched)), mismatched);
  const feed = recentRunItems(base, LINKS.traceUrl);
  const week = datesOf(windowNamed(windows, "weekCompared"));
  const attention = attentionRows(contextOf(stored, now, week.from), week.from);
  const since = text(byName("Long streak"), "failingSince");
  const span = (/** @type {string} */ name) => windowNamed(windowsOf(0), name).to - windowNamed(windowsOf(0), name).from;
  return [
    check("every state of a procedure is listed", STATES.every((state) => rows.some((row) => row.status === state)), rows.map((row) => row.status)),
    check("a streak of more than 12 failures that started more than 7 days ago", Boolean(since) && now - new Date(since).getTime() > 7 * MS_PER_DAY, since),
    check("the strip of a long streak holds 12 runs", list(byName("Long streak"), "lastRuns").length === 12, list(byName("Long streak"), "lastRuns").length),
    check("a kept comparison, a dropped one and one kept by a test run", Boolean(kept("weekCompared").compareFrom) && !kept("olderThanRetention").compareFrom && Boolean(kept("comparedByATestRun").compareFrom), "compare"),
    check("a compared change that is a number, null and 0", deltas.some((delta) => isNumber(delta) && delta !== 0) && deltas.includes(null) && deltas.includes(0), deltas),
    check("a compared series with fewer buckets than the window has null points", list(chart, "comparisonSeries").some((series) => list(series, "data").some((point) => point.y === null)), chart),
    check("the feed holds four runs of one start and a deleted procedure", feed.filter((item) => item.date === feed[2]?.date).length === 4 && feed.some((item) => text(item, "title").includes("deletedProcedure")), feed.length),
    check("Needs attention holds more than five procedures", attention.total > 5 && attention.items.length === 5, attention.total),
    check("a window of two days is hourly and one millisecond more is daily", span("twoDays") === 2 * MS_PER_DAY && span("twoDaysAndAMillisecond") === 2 * MS_PER_DAY + 1, [span("twoDays"), span("twoDaysAndAMillisecond")]),
  ];
}

/**
 * @param {Stored} stored What the database stores
 * @param {number} from When the journey started
 * @param {number} to When it ended
 * @returns {Check} Whether no run sits at an edge that moves with the clock
 */
function clearOfMovingEdges(stored, from, to) {
  const edges = [7 * MS_PER_DAY, 30 * MS_PER_DAY];
  const near = stored.runs.filter((run) => edges.some((edge) => timeOf(run.startedAt) > from - edge - SLACK_MS && timeOf(run.startedAt) < to - edge + SLACK_MS));
  return check("no run sits at the edge of the 7 day state window or of the lookback, which move with the clock", near.length === 0, near.map((run) => run._id));
}

/** @type {import("../../auto.mjs").Row[]} */
export const equivalenceJourneys = [
  {
    id: "every-stats-answer-equals-the-run-by-run-reference-on-a-fixture",
    integration: true,
    title: "every stats answer equals the answer the run-by-run algorithm gives on the same rows: the health banner, the four figures with and without a compared window, the Runs chart, Needs attention, the recent runs, the procedure counts, By trigger, the procedures list and the Library usage, in order and with the ties of one start read as sets, test runs ignored",
    entryPoint: "GET /stats/{health,kpi/:metric,runs-per-day,attention,recent-runs,procedures,triggers}, /procedures/summary, /tables/procedures/{list,count,get}, /library/usage/:catalog",
    async run(/** @type {Ctx} */ ctx) {
      const started = Date.now();
      const hour = Math.floor(started / MS_PER_HOUR) * MS_PER_HOUR;
      const windows = windowsOf(hour);
      const ids = await seedFixture(ctx, hour);
      const stored = await readStored(ctx);
      const calls = expectations(stored, windows, ids, Date.now());
      await ctx.verify("the fixture", [check("every procedure was created", Object.values(ids).every((id) => id.length > 0), ids), ...fixtureCases(stored, windows, Date.now())]);
      /** @type {Check[]} */
      const sequential = [];
      for (const call of calls) sequential.push(matches(call, await auto(ctx, call.label, "GET", call.path)));
      await ctx.verify("the answers, one after the other", sequential);
      const burst = calls.filter((call) => call.label.endsWith(" weekCompared") || ["recent runs", "procedure counts", "trigger counts"].includes(call.label));
      const answers = await Promise.all(burst.map((call) => auto(ctx, `${call.label} (together)`, "GET", call.path)));
      await ctx.verify("the Overview's burst, asked at once", [
        check("the burst holds the Overview's ten reads", burst.length === OVERVIEW_READS, burst.map((call) => call.label)),
        ...burst.map((call, index) => matches({ ...call, label: `${call.label} asked together` }, answers[index] ?? { status: null, body: undefined })),
      ]);
      await ctx.verify("the clock", [clearOfMovingEdges(await readStored(ctx), started, Date.now())]);
    },
  },
];
