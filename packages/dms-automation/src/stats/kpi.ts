import { MS_PER_DAY, MS_PER_HOUR } from "../types/constants";
import {
  deltaPercent,
  type HealthRun,
  runFigures,
  type RunFigures,
  runsBetween,
  timeOf,
} from "./health";

/** The figures a KPI card can show. */
const KPI_METRICS = ["runs", "success-rate", "failed", "duration-p95"] as const;

export type KpiMetric = (typeof KPI_METRICS)[number];

export function isKpiMetric(value: string): value is KpiMetric {
  return KPI_METRICS.some((metric) => metric === value);
}

/**
 * What a `KpiCard` reads from its `fetchUrl`. A figure with nothing to
 * compute it from (a rate over no run) is left out: the card then shows "—",
 * where `null` would read as 0.
 */
export interface KpiPayload {
  value?: number;
  previousValue?: number;
  delta?: number | null;
  sparkline: number[];
}

/** A time window and the one it is compared with. */
export interface KpiWindow {
  from: Date;
  to: Date;
  compareFrom?: Date;
  compareTo?: Date;
}

const PERCENT = 100;
const ONE_DECIMAL = 10;

/**
 * Fewer runs than this in the compared window and the change says nothing:
 * 1 run against 40 reads "+3,900%", a single failed run swings the rate.
 */
export const MIN_COMPARED_RUNS = 10;

function roundOne(value: number): number {
  return Math.round(value * ONE_DECIMAL) / ONE_DECIMAL;
}

const METRIC_VALUE: Record<KpiMetric, (f: RunFigures) => number | null> = {
  runs: (f) => f.total,
  failed: (f) => f.failed,
  "success-rate": (f) =>
    f.successRate === null ? null : roundOne(f.successRate * PERCENT),
  "duration-p95": (f) => f.p95DurationMs,
};

/** Value of a metric over a set of runs. */
function metricValue(
  metric: KpiMetric,
  runs: readonly HealthRun[],
): number | null {
  return METRIC_VALUE[metric](runFigures(runs));
}

/**
 * The change shown under a KPI, in percent of the previous value: the DMS
 * KPI card prints it with "%", so the success rate is no exception.
 * `null` when it would mislead: too few runs to compare with, or a previous
 * value of 0, which no percentage measures.
 */
function kpiDelta(
  value: number,
  previous: number,
  previousRuns: number,
): number | null {
  if (previousRuns < MIN_COMPARED_RUNS) return null;
  if (previous === 0) return value === 0 ? 0 : null;
  return deltaPercent(value, previous);
}

/**
 * Bucket width of a sparkline: hours for a window up to two days, days
 * beyond.
 */
function bucketMs(window: KpiWindow): number {
  const span = window.to.getTime() - window.from.getTime();
  return span <= 2 * MS_PER_DAY ? MS_PER_HOUR : MS_PER_DAY;
}

/**
 * Start of every bucket of a window, oldest first. Hours start on the hour,
 * so a bar reads "13:00–14:00" rather than "13:07–14:07"; days start where
 * the window does, the reader's midnight for the period presets.
 */
export function bucketStarts(window: KpiWindow): Date[] {
  const step = bucketMs(window);
  const first =
    step === MS_PER_HOUR
      ? Math.floor(window.from.getTime() / MS_PER_HOUR) * MS_PER_HOUR
      : window.from.getTime();
  const starts: Date[] = [];
  const end = window.to.getTime();
  for (let t = first; t < end; t += step) {
    starts.push(new Date(t));
  }
  return starts;
}

/**
 * The runs of each bucket of a window, oldest bucket first, in one pass over
 * the runs. Runs outside the window are left out.
 */
export function runsPerBucket<R extends HealthRun>(
  runs: readonly R[],
  window: KpiWindow,
): R[][] {
  const starts = bucketStarts(window);
  const buckets: R[][] = starts.map(() => []);
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
 * A sparkline point per bucket. A count is 0 in an empty bucket; a rate or a
 * duration has no value there, so the line carries the last one on instead
 * of dropping to 0 (and starts on the first one known). No value at all, no
 * line.
 */
function sparklineOf(metric: KpiMetric, buckets: HealthRun[][]): number[] {
  const values = buckets.map((bucket) => metricValue(metric, bucket));
  const firstKnown = values.find((v): v is number => v !== null);
  if (firstKnown === undefined) return [];
  let last = firstKnown;
  return values.map((v) => {
    if (v !== null) last = v;
    return v ?? last;
  });
}

/** A KPI card's payload: the value, the comparison and a sparkline. */
export function kpiPayload(
  metric: KpiMetric,
  runs: readonly HealthRun[],
  window: KpiWindow,
): KpiPayload {
  const current = runsBetween(runs, window.from, window.to);
  const value = metricValue(metric, current);
  const payload: KpiPayload = {
    sparkline: sparklineOf(metric, runsPerBucket(current, window)),
  };
  if (value !== null) payload.value = value;
  if (window.compareFrom && window.compareTo) {
    const compared = runsBetween(runs, window.compareFrom, window.compareTo);
    const previous = metricValue(metric, compared);
    if (previous !== null) payload.previousValue = previous;
    payload.delta =
      value !== null && previous !== null
        ? kpiDelta(value, previous, compared.length)
        : null;
  }
  return payload;
}
