import { GetModel } from "@antelopejs/interface-database-decorators";
import type { RunCounts } from "../../stats/health";
import {
  bucketMs,
  bucketStarts,
  type KpiWindow,
  runsPerBucket,
  type Tally,
  tallyOf,
  type WindowTally,
} from "../../stats/kpi";
import { DATABASE_NAME } from "../../types/constants";
import { ProcedureRunModel, type StatsQuery } from "./procedure_run.model";
import type { StatsWindow } from "./stats.model";

function runModel(): ProcedureRunModel {
  return GetModel(ProcedureRunModel, DATABASE_NAME);
}

/** How many production runs started in `[from, to]` ended each way. */
export async function countsBetween(from: Date, to: Date): Promise<RunCounts> {
  const perStatus = await runModel().countPerStatus({ from, to });
  let total = 0;
  for (const runs of perStatus.values()) total += runs;
  return {
    total,
    ok: perStatus.get("ok") ?? 0,
    failed: perStatus.get("failed") ?? 0,
  };
}

/** The tally of a window with no percentile read. */
function countedTally(counts: RunCounts): Tally {
  return { ...counts, p95DurationMs: null };
}

/**
 * How many production runs started in each bucket of a window, oldest bucket
 * first; a run past the last bucket is left out.
 */
async function bucketCounts(
  window: KpiWindow,
  status?: StatsQuery["status"],
): Promise<number[]> {
  const starts = bucketStarts(window);
  const first = starts[0];
  if (!first) return [];
  const counts = await runModel().countPerBucket(
    { from: window.from, to: window.to, status },
    first,
    bucketMs(window),
  );
  return starts.map((_, i) => counts.get(i) ?? 0);
}

/**
 * The tally of a window and of each of its buckets. With `durations`, the
 * runs' timings are read for the 95th percentile of their durations, which
 * no query computes.
 */
export async function windowTally(
  window: KpiWindow,
  durations: boolean,
): Promise<WindowTally> {
  if (durations) {
    const runs = await runModel().timingsForStats(window);
    return {
      total: tallyOf(runs),
      buckets: runsPerBucket(runs, window).map(tallyOf),
    };
  }
  const [counts, all, ok, failed] = await Promise.all([
    countsBetween(window.from, window.to),
    bucketCounts(window),
    bucketCounts(window, "ok"),
    bucketCounts(window, "failed"),
  ]);
  return {
    total: countedTally(counts),
    buckets: all.map((total, i) =>
      countedTally({ total, ok: ok[i] ?? 0, failed: failed[i] ?? 0 }),
    ),
  };
}

/** The tally of the compared window, when the window compares. */
export async function comparedTally(
  window: StatsWindow,
  durations: boolean,
): Promise<Tally | undefined> {
  if (!window.compareFrom || !window.compareTo) return undefined;
  const from = window.compareFrom;
  const to = window.compareTo;
  if (durations) return tallyOf(await runModel().timingsForStats({ from, to }));
  return countedTally(await countsBetween(from, to));
}

/** How many production runs started in each bucket of the compared window. */
export async function comparedBucketCounts(
  window: StatsWindow,
): Promise<number[] | undefined> {
  if (!window.compareFrom || !window.compareTo) return undefined;
  return bucketCounts({ from: window.compareFrom, to: window.compareTo });
}
