import { text } from "../../auto.mjs";

/**
 * @typedef {{ _id: string, procedureId: string, procedureName?: string, startedAt: Date, endedAt?: Date, status: string, errorMessage?: string, kind: string, failedNodeId?: string }} RefRun
 * @typedef {{ state: string, runs: number, ok: number, failed: number, successRate: number | null, avgDurationMs: number | null, lastRun?: RefRun, failingSince?: Date, failureStreak: number, armError?: Record<string, unknown>, triggerError?: string, recentRuns: RefRun[] }} RefHealth
 * @typedef {{ _id: string, enabled: boolean, hasTrigger: boolean, pausedAt?: Date, armError?: Record<string, unknown> }} RefSubject
 * @typedef {{ total: number, ok: number, failed: number, successRate: number | null, avgDurationMs: number | null, p95DurationMs: number | null }} RefFigures
 * @typedef {{ from: Date, to: Date, compareFrom?: Date, compareTo?: Date }} RefWindow
 */

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
export const MIN_COMPARED_RUNS = 10;
const RECENT_RUNS = 12;
const PROCEDURE_STATES = ["failing", "degraded", "healthy", "paused", "draft"];

/**
 * @param {Date | string} value A date
 * @returns {number} Epoch milliseconds
 */
export function timeOf(value) {
  return new Date(value).getTime();
}

/**
 * @param {RefRun} run A run
 * @returns {number | null} How long it lasted, null while it has no end
 */
export function durationOf(run) {
  return run.endedAt ? timeOf(run.endedAt) - timeOf(run.startedAt) : null;
}

/**
 * @param {readonly RefRun[]} runs Runs in any order
 * @returns {RefRun[]} The runs, newest first; equal starts keep their order
 */
function newestFirst(runs) {
  return [...runs].sort((a, b) => timeOf(b.startedAt) - timeOf(a.startedAt));
}

/**
 * @param {readonly number[]} values Numbers
 * @returns {number | null} Their mean, rounded
 */
function average(values) {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * @param {readonly number[]} values Numbers
 * @param {number} p A fraction between 0 and 1
 * @returns {number | null} The nearest-rank percentile
 */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, rank)] ?? 0);
}

/**
 * @param {readonly RefRun[]} runs Runs, newest first
 * @returns {RefRun[]} The leading failed runs
 */
function streakOf(runs) {
  /** @type {RefRun[]} */
  const streak = [];
  for (const run of runs) {
    if (run.status !== "failed") break;
    streak.push(run);
  }
  return streak;
}

/**
 * @param {RefSubject} procedure What the rules know of the procedure
 * @param {RefRun | undefined} lastRun Its newest run
 * @param {number} failedInWindow Failed runs in the window
 * @returns {string} The state
 */
function stateOf(procedure, lastRun, failedInWindow) {
  if (!procedure.hasTrigger) return "draft";
  if (!procedure.enabled) return procedure.pausedAt || lastRun ? "paused" : "draft";
  if (procedure.armError || lastRun?.status === "failed") return "failing";
  return failedInWindow > 0 ? "degraded" : "healthy";
}

/**
 * @param {RefSubject} procedure The procedure
 * @param {readonly RefRun[]} runs Its production runs, in any order
 * @param {Date} since The start of the window
 * @returns {RefHealth} Its health
 */
export function procedureHealth(procedure, runs, since) {
  const sorted = newestFirst(runs);
  const inWindow = sorted.filter((r) => timeOf(r.startedAt) >= since.getTime());
  const ok = inWindow.filter((r) => r.status === "ok").length;
  const failed = inWindow.filter((r) => r.status === "failed").length;
  const durations = inWindow.map(durationOf).filter((d) => d !== null);
  const lastRun = sorted[0];
  const streak = streakOf(sorted);
  /** @type {RefHealth} */
  const health = {
    state: stateOf(procedure, lastRun, failed),
    runs: inWindow.length,
    ok,
    failed,
    successRate: ok + failed > 0 ? ok / (ok + failed) : null,
    avgDurationMs: average(durations),
    failureStreak: streak.length,
    recentRuns: sorted.slice(0, RECENT_RUNS).reverse(),
  };
  if (lastRun) health.lastRun = lastRun;
  if (procedure.armError) {
    health.armError = procedure.armError;
    health.triggerError = text(procedure.armError, "message");
  }
  const firstOfStreak = streak.at(-1);
  if (firstOfStreak) health.failingSince = new Date(firstOfStreak.startedAt);
  return health;
}

/**
 * @param {readonly RefRun[]} runs A set of runs
 * @returns {RefFigures} Their figures
 */
export function runFigures(runs) {
  const ok = runs.filter((r) => r.status === "ok").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const durations = runs.map(durationOf).filter((d) => d !== null);
  return {
    total: runs.length,
    ok,
    failed,
    successRate: ok + failed > 0 ? ok / (ok + failed) : null,
    avgDurationMs: average(durations),
    p95DurationMs: percentile(durations, 0.95),
  };
}

/**
 * @template {RefRun} R
 * @param {readonly R[]} runs Runs
 * @param {Date} from The start, included
 * @param {Date} to The end, included
 * @returns {R[]} The runs started in `[from, to]`
 */
export function runsBetween(runs, from, to) {
  const start = from.getTime();
  const end = to.getTime();
  return runs.filter((r) => {
    const t = timeOf(r.startedAt);
    return t >= start && t <= end;
  });
}

/**
 * @template {RefRun} R
 * @param {readonly R[]} runs Runs
 * @returns {Map<string, R[]>} The runs by procedure id
 */
export function byProcedure(runs) {
  /** @type {Map<string, R[]>} */
  const out = new Map();
  for (const run of runs) {
    const list = out.get(run.procedureId) ?? [];
    list.push(run);
    out.set(run.procedureId, list);
  }
  return out;
}

/**
 * @param {number} current The current value
 * @param {number} previous The previous value
 * @returns {number} The change in percent, one decimal
 */
export function deltaPercent(current, previous) {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * @param {string} state A procedure state
 * @returns {number} Its place in the order that puts the procedures needing attention first
 */
export function stateRank(state) {
  const index = PROCEDURE_STATES.indexOf(state);
  return index < 0 ? PROCEDURE_STATES.length : index;
}

/**
 * @param {string} metric `runs`, `success-rate`, `failed` or `duration-p95`
 * @param {readonly RefRun[]} runs A set of runs
 * @returns {number | null} The figure over them
 */
function metricValue(metric, runs) {
  const figures = runFigures(runs);
  if (metric === "runs") return figures.total;
  if (metric === "failed") return figures.failed;
  if (metric === "success-rate") return figures.successRate === null ? null : Math.round(figures.successRate * 100 * 10) / 10;
  return figures.p95DurationMs;
}

/**
 * @param {number} value The value
 * @param {number} previous The compared value
 * @param {number} previousRuns The runs of the compared window
 * @returns {number | null} The change, null when it would mislead
 */
function kpiDelta(value, previous, previousRuns) {
  if (previousRuns < MIN_COMPARED_RUNS) return null;
  if (previous === 0) return value === 0 ? 0 : null;
  return deltaPercent(value, previous);
}

/**
 * @param {RefWindow} window A window
 * @returns {number} The bucket width: an hour up to two days, a day beyond
 */
function bucketMs(window) {
  const span = window.to.getTime() - window.from.getTime();
  return span <= 2 * MS_PER_DAY ? MS_PER_HOUR : MS_PER_DAY;
}

/**
 * @param {RefWindow} window A window
 * @returns {Date[]} The start of every bucket, oldest first
 */
export function bucketStarts(window) {
  const step = bucketMs(window);
  const first = step === MS_PER_HOUR ? Math.floor(window.from.getTime() / MS_PER_HOUR) * MS_PER_HOUR : window.from.getTime();
  /** @type {Date[]} */
  const starts = [];
  const end = window.to.getTime();
  for (let t = first; t < end; t += step) starts.push(new Date(t));
  return starts;
}

/**
 * @template {RefRun} R
 * @param {readonly R[]} runs Runs
 * @param {RefWindow} window A window
 * @returns {R[][]} The runs of each bucket, oldest bucket first
 */
export function runsPerBucket(runs, window) {
  const starts = bucketStarts(window);
  /** @type {R[][]} */
  const buckets = starts.map(() => []);
  const first = starts[0]?.getTime();
  if (first === undefined) return buckets;
  const step = bucketMs(window);
  const from = window.from.getTime();
  const to = window.to.getTime();
  for (const run of runs) {
    const t = timeOf(run.startedAt);
    if (t < from || t > to) continue;
    buckets[Math.floor((t - first) / step)]?.push(run);
  }
  return buckets;
}

/**
 * @param {string} metric The figure
 * @param {RefRun[][]} buckets The runs of each bucket
 * @returns {number[]} A point per bucket, an empty bucket carrying the last value on
 */
function sparklineOf(metric, buckets) {
  const values = buckets.map((bucket) => metricValue(metric, bucket));
  const firstKnown = values.find((v) => v !== null);
  if (firstKnown === undefined || firstKnown === null) return [];
  let last = firstKnown;
  return values.map((v) => {
    if (v !== null) last = v;
    return v ?? last;
  });
}

/**
 * @param {string} metric The figure
 * @param {readonly RefRun[]} runs The production runs read
 * @param {RefWindow} window The window and its comparison
 * @returns {Record<string, unknown>} What a KPI card reads
 */
export function kpiPayload(metric, runs, window) {
  const current = runsBetween(runs, window.from, window.to);
  const value = metricValue(metric, current);
  /** @type {Record<string, unknown>} */
  const payload = { sparkline: sparklineOf(metric, runsPerBucket(current, window)) };
  if (value !== null) payload.value = value;
  if (window.compareFrom && window.compareTo) {
    const compared = runsBetween(runs, window.compareFrom, window.compareTo);
    const previous = metricValue(metric, compared);
    if (previous !== null) payload.previousValue = previous;
    payload.delta = value !== null && previous !== null ? kpiDelta(value, previous, compared.length) : null;
  }
  return payload;
}
