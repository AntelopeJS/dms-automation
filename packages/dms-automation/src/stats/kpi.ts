import { MS_PER_DAY, MS_PER_HOUR } from "../types/constants";
import {
  deltaPercent,
  type HealthRun,
  runFigures,
  type RunFigures,
  runsBetween,
} from "./health";

/** The figures a KPI card can show. */
const KPI_METRICS = ["runs", "success-rate", "failed", "duration-p95"] as const;

export type KpiMetric = (typeof KPI_METRICS)[number];

export function isKpiMetric(value: string): value is KpiMetric {
  return (KPI_METRICS as readonly string[]).includes(value);
}

/** What a `KpiCard` reads from its `fetchUrl`. */
export interface KpiPayload {
  value: number | null;
  previousValue?: number | null;
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

const MS_PER_SECOND = 1000;
const PERCENT = 100;
const ONE_DECIMAL = 10;

function roundOne(value: number): number {
  return Math.round(value * ONE_DECIMAL) / ONE_DECIMAL;
}

const METRIC_VALUE: Record<KpiMetric, (f: RunFigures) => number | null> = {
  runs: (f) => f.total,
  failed: (f) => f.failed,
  "success-rate": (f) =>
    f.successRate === null ? null : roundOne(f.successRate * PERCENT),
  "duration-p95": (f) =>
    f.p95DurationMs === null ? null : roundOne(f.p95DurationMs / MS_PER_SECOND),
};

/** Value of a metric over a set of runs. */
function metricValue(
  metric: KpiMetric,
  runs: readonly HealthRun[],
): number | null {
  return METRIC_VALUE[metric](runFigures(runs));
}

/**
 * Bucket width of a sparkline: hours for a window up to two days, days
 * beyond.
 */
function bucketMs(window: KpiWindow): number {
  const span = window.to.getTime() - window.from.getTime();
  return span <= 2 * MS_PER_DAY ? MS_PER_HOUR : MS_PER_DAY;
}

/** Start of every bucket of a window, oldest first. */
export function bucketStarts(window: KpiWindow): Date[] {
  const step = bucketMs(window);
  const starts: Date[] = [];
  const end = window.to.getTime();
  for (let t = window.from.getTime(); t < end; t += step) {
    starts.push(new Date(t));
  }
  return starts;
}

/** The runs of each bucket of a window, oldest bucket first. */
export function runsPerBucket<R extends HealthRun>(
  runs: readonly R[],
  window: KpiWindow,
): R[][] {
  const step = bucketMs(window);
  return bucketStarts(window).map((start) =>
    runsBetween(runs, start, new Date(start.getTime() + step - 1)),
  );
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
    value,
    sparkline: runsPerBucket(current, window).map(
      (bucket) => metricValue(metric, bucket) ?? 0,
    ),
  };
  if (window.compareFrom && window.compareTo) {
    const previous = metricValue(
      metric,
      runsBetween(runs, window.compareFrom, window.compareTo),
    );
    payload.previousValue = previous;
    payload.delta =
      value !== null && previous !== null
        ? deltaPercent(value, previous)
        : null;
  }
  return payload;
}
