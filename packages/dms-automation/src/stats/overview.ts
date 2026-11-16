import {
  failedStepOf,
  healthByProcedure,
  lastFailedOfProcedure,
  newestFailedRun,
  newestRuns,
  procedureNameOf,
  type StatsContext,
  type StatsScope,
  type StatsWindow,
} from "../db/models/stats.model";
import {
  comparedBucketCounts,
  comparedTally,
  countsBetween,
  windowTally,
} from "../db/models/window_tally.model";
import type { StatsRun } from "../db/models/procedure_run.model";
import type { ArmError } from "../runtime/armErrors";
import { type StepName, stepTitle } from "../runtime/describe";
import {
  durationOf,
  type ProcedureHealth,
  type ProcedureState,
  type RunCounts,
  stateRank,
  timeOf,
} from "./health";
import { bucketStarts, kpiPayload, type Tally } from "./kpi";
import { isNumber } from "../types/guards";

/** The last failure, as the overview links to it. */
interface FailureRef {
  runId: string;
  procedureId: string;
  procedureName: string;
  startedAt: string;
  error: string;
  step: StepName | null;
}

/** A failing procedure in the overview's health line. */
interface FailingProcedure {
  procedureId: string;
  name: string;
  since: string | null;
  streak: number;
  lastRunId: string | null;
  /** Why a trigger failed to arm, when that is why it fails. */
  armError: ArmError | null;
}

/** What the overview's health line says. */
type OverallState = "empty" | "failing" | "degraded" | "healthy" | "idle";

export interface HealthHero {
  state: OverallState;
  updatedAt: string;
  procedures: number;
  enabled: number;
  failing: FailingProcedure[];
  degraded: number;
  paused: number;
  figures: RunCounts;
  lastFailure: FailureRef | null;
}

function failureRef(ctx: StatsScope, run: StatsRun): FailureRef {
  return {
    runId: run._id,
    procedureId: run.procedureId,
    procedureName: procedureNameOf(ctx, run.procedureId) ?? "",
    startedAt: new Date(run.startedAt).toISOString(),
    error: run.errorMessage ?? "",
    step: failedStepOf(ctx, run) ?? null,
  };
}

function overallState(
  procedures: number,
  states: ProcedureState[],
  figures: RunCounts,
): OverallState {
  if (procedures === 0) return "empty";
  if (states.includes("failing")) return "failing";
  if (states.includes("degraded")) return "degraded";
  return figures.total > 0 ? "healthy" : "idle";
}

/** What "Needs attention" and the health line sort procedures by. */
interface Urgency {
  state: ProcedureState;
  streak: number;
  failed: number;
}

/**
 * Failing first, then degraded, then paused; within a state, the longest run
 * of failures, then the most failures.
 */
function byUrgency(a: Urgency, b: Urgency): number {
  return (
    stateRank(a.state) - stateRank(b.state) ||
    b.streak - a.streak ||
    b.failed - a.failed
  );
}

/**
 * The overview's one-line state, over the selected window: a procedure whose
 * last run failed is failing whatever the window, one that failed in the
 * window and recovered is degraded.
 *
 * In the order of "Needs attention", so the one the line names is its first.
 *
 * While a procedure is failing, its failure is the one to inspect (none
 * when it fails because a trigger did not arm).
 */
export async function healthHero(
  ctx: StatsContext,
  window: StatsWindow,
): Promise<HealthHero> {
  const [health, figures] = await Promise.all([
    healthByProcedure(ctx, window.from),
    countsBetween(window.from, window.to),
  ]);
  const states = [...health.values()].map((h) => h.state);
  const urgency = (id: string): Urgency => {
    const h = health.get(id)!;
    return { state: h.state, streak: h.failureStreak, failed: h.failed };
  };
  const failing = ctx.procedures
    .filter((p) => health.get(p.procedure._id)?.state === "failing")
    .sort((a, b) =>
      byUrgency(urgency(a.procedure._id), urgency(b.procedure._id)),
    )
    .map((p) => {
      const h = health.get(p.procedure._id)!;
      return {
        procedureId: p.procedure._id,
        name: p.procedure.name,
        since: h.failingSince?.toISOString() ?? null,
        streak: h.failureStreak,
        lastRunId: h.lastRun?._id ?? null,
        armError: h.armError ?? null,
      };
    });
  const first = failing[0];
  const firstLastRun = first && ctx.runsOf.get(first.procedureId)?.recent[0];
  const lastFailed = first
    ? firstLastRun?.status === "failed"
      ? firstLastRun
      : undefined
    : await newestFailedRun(ctx);
  return {
    state: overallState(ctx.procedures.length, states, figures),
    updatedAt: ctx.now.toISOString(),
    procedures: ctx.procedures.length,
    enabled: ctx.procedures.filter((p) => p.procedure.enabled).length,
    failing,
    degraded: states.filter((s) => s === "degraded").length,
    paused: states.filter((s) => s === "paused").length,
    figures,
    lastFailure: lastFailed ? failureRef(ctx, lastFailed) : null,
  };
}

/** One row of the overview's "Needs attention" list. */
interface AttentionRow {
  procedureId: string;
  name: string;
  state: ProcedureState;
  runs: number;
  failed: number;
  streak: number;
  since: string | null;
  lastRunId: string | null;
  lastFailure: FailureRef | null;
  /** The last run succeeded after a failure: the procedure recovered. */
  recovered: boolean;
  /** Why a trigger failed to arm, when that is why it fails. */
  armError: ArmError | null;
  pausedAt: string | null;
  pausedBy: string | null;
  triggerType: string | null;
}

const ATTENTION_STATES = new Set<ProcedureState>([
  "failing",
  "degraded",
  "paused",
]);

/** Rows of "Needs attention"; the rest is counted and a link lists them all. */
const MAX_ATTENTION_ROWS = 5;

function isDismissed(
  dismissedAt: Date | null | undefined,
  lastFailure: StatsRun | undefined,
): boolean {
  if (!dismissedAt || !lastFailure) return false;
  return timeOf(lastFailure.startedAt) <= new Date(dismissedAt).getTime();
}

function attentionRow(
  ctx: StatsContext,
  procedureId: string,
  health: ProcedureHealth,
): AttentionRow {
  const facts = ctx.byId.get(procedureId)!;
  const procedure = facts.procedure;
  const lastFailed = lastFailedOfProcedure(ctx, procedureId);
  return {
    procedureId,
    name: procedure.name,
    state: health.state,
    runs: health.runs,
    failed: health.failed,
    streak: health.failureStreak,
    since: health.failingSince?.toISOString() ?? null,
    lastRunId: health.lastRun?._id ?? null,
    lastFailure: lastFailed ? failureRef(ctx, lastFailed) : null,
    recovered: health.state === "degraded",
    armError: health.armError ?? null,
    pausedAt: procedure.pausedAt
      ? new Date(procedure.pausedAt).toISOString()
      : null,
    pausedBy: procedure.pausedBy ?? null,
    triggerType: facts.triggers[0]?.typeId ?? null,
  };
}

/** The first rows of "Needs attention", and how many procedures it holds. */
export interface AttentionList {
  items: AttentionRow[];
  total: number;
}

/**
 * The procedures that need someone: failing first, then degraded (until
 * dismissed, or until they fail again), then paused. Degraded is read since
 * `since`, the start of the overview's period, as its health line does; the
 * state window of the procedure list without one.
 */
export async function attentionRows(
  ctx: StatsContext,
  since?: Date,
): Promise<AttentionList> {
  const health = await healthByProcedure(ctx, since);
  const rows: AttentionRow[] = [];
  for (const facts of ctx.procedures) {
    const id = facts.procedure._id;
    const h = health.get(id);
    if (!h || !ATTENTION_STATES.has(h.state)) continue;
    const lastFailed = lastFailedOfProcedure(ctx, id);
    const dismissed =
      h.state === "degraded" &&
      isDismissed(facts.procedure.attentionDismissedAt, lastFailed);
    if (!dismissed) rows.push(attentionRow(ctx, id, h));
  }
  return {
    items: rows.sort(byUrgency).slice(0, MAX_ATTENTION_ROWS),
    total: rows.length,
  };
}

/** One item of an `ActivityFeed`. */
export interface FeedItem {
  id: string;
  icon: string;
  tone: "success" | "error";
  title: string;
  meta: string[];
  params: Record<string, string>;
  date: string;
  to: string;
}

const MS_PER_SECOND = 1000;

/** A duration the way the run lists show it: "640 ms", "2.4 s". */
function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < MS_PER_SECOND) return `${ms} ms`;
  return `${(ms / MS_PER_SECOND).toFixed(1)} s`;
}

/** Runs the overview's recent runs show; its skeleton draws as many rows. */
export const RECENT_RUNS = 8;

/** The values a feed line names: how long it took, what failed, which step and procedure. */
type FeedParams = {
  duration: string;
  error: string;
  step?: string;
  name?: string;
};
/**
 * The overview's recent runs, newest first, each linking to its trace.
 *
 * A deleted procedure keeps the name its runs were stored with.
 */
export async function recentRunItems(
  ctx: StatsScope,
  traceUrl: string,
): Promise<FeedItem[]> {
  return (await newestRuns(ctx, RECENT_RUNS)).map((run) => {
    const failed = run.status === "failed";
    const step = failedStepOf(ctx, run);
    const params: FeedParams = {
      duration: formatDuration(durationOf(run)),
      error: run.errorMessage ?? "",
    };
    if (step) params.step = stepTitle(step);
    const name = procedureNameOf(ctx, run.procedureId);
    if (name === undefined && run.procedureName) {
      params.name = run.procedureName;
    }
    const outcome = failed
      ? step
        ? "$dms_automation.feed.failedAt"
        : "$dms_automation.feed.failed"
      : "$dms_automation.feed.completed";
    return {
      id: run._id,
      icon: failed ? "i-ph-x-circle" : "i-ph-check-circle",
      tone: failed ? "error" : "success",
      title:
        name ??
        (params.name
          ? "$dms_automation.feed.deletedProcedureNamed"
          : "$dms_automation.feed.deletedProcedure"),
      meta: [outcome, "$dms_automation.feed.duration"],
      params,
      date: new Date(run.startedAt).toISOString(),
      to: `${traceUrl}?run=${run._id}`,
    };
  });
}

/** One line of a `KeyValueList`. */
export interface KeyValueItem {
  id: string;
  label: string;
  value: number;
  type?: "status";
  tone?: "error" | "warning" | "success" | "neutral" | "info";
  to?: string;
}

/** The states counted, in the order of the procedure list's tabs. */
const COUNTED_STATES: readonly ProcedureState[] = [
  "failing",
  "degraded",
  "healthy",
  "paused",
  "draft",
];

/**
 * Lines of the overview's procedure counts, always all of them: the total and
 * one per state. Its skeleton draws as many rows.
 */
export const PROCEDURE_COUNT_LINES = COUNTED_STATES.length + 1;

/** The tone of a state's count once it is above 0. */
const COUNT_TONE: Partial<Record<ProcedureState, KeyValueItem["tone"]>> = {
  failing: "error",
  degraded: "warning",
};

/**
 * The overview's procedure counts: the total, then one line per state in the
 * order of the list's tabs, adding up to the total, each linking to its tab.
 */
export async function procedureCounts(
  ctx: StatsContext,
  proceduresUrl: string,
): Promise<KeyValueItem[]> {
  const health = [...(await healthByProcedure(ctx)).values()];
  const total: KeyValueItem = {
    id: "total",
    label: "$dms_automation.overview.counts.total",
    value: ctx.procedures.length,
    to: proceduresUrl,
  };
  const states = COUNTED_STATES.map((state) => {
    const value = health.filter((h) => h.state === state).length;
    const item: KeyValueItem = {
      id: state,
      label: `$dms_automation.overview.counts.${state}`,
      value,
      to: `${proceduresUrl}?tab=${state}`,
    };
    const tone = COUNT_TONE[state];
    if (tone && value > 0) {
      item.type = "status";
      item.tone = tone;
    }
    return item;
  });
  return [total, ...states];
}

/** One row of a `TopListCard`. */
export interface TopListItem {
  id: string;
  title: string;
  value: number;
  description?: string;
}

/** How many procedures each trigger type starts, most used first. */
export function triggerCounts(
  ctx: Pick<StatsScope, "procedures">,
): TopListItem[] {
  const counts = new Map<string, TopListItem>();
  for (const facts of ctx.procedures) {
    const types = new Map(facts.triggers.map((t) => [t.typeId, t.typeName]));
    for (const [typeId, typeName] of types) {
      const item = counts.get(typeId) ?? {
        id: typeId,
        title: typeName,
        value: 0,
      };
      item.value += 1;
      counts.set(typeId, item);
    }
  }
  return [...counts.values()].sort((a, b) => b.value - a.value);
}

/** A point of a chart series; `null` where the window has no bucket. */
interface ChartPoint {
  x: string;
  y: number | null;
}

/** A series of a `ChartCard`, drawn as a line when `type` says so. */
interface ChartSeriesPayload {
  name: string;
  data: ChartPoint[];
  type?: "line";
}

/**
 * What a `ChartCard` reads: a headline value, its series, and with a
 * comparison the compared value, the change and the compared series.
 */
export interface ChartPayload {
  value: number;
  previousValue?: number;
  delta?: number;
  series: ChartSeriesPayload[];
  comparisonSeries?: ChartSeriesPayload[];
}

/**
 * The runs of every bucket of the compared window, drawn over the buckets of
 * the window: the first hour (or day) of the one under the first of the
 * other. Both windows are as long, so they have as many buckets.
 *
 * A line over the stacked bars, dashed by the chart as a comparison.
 */
function comparedRunsSeries(
  buckets: number[],
  starts: Date[],
): ChartSeriesPayload {
  return {
    name: "$dms_automation.overview.comparedRuns",
    type: "line",
    data: starts.map((start, i) => ({
      x: start.toISOString(),
      y: buckets[i] ?? null,
    })),
  };
}

/**
 * Succeeded and failed runs per bucket (hour or day) of the window and, when
 * the period compares, the runs of the compared window bucket by bucket with
 * the change of the total, measured as the Runs KPI measures it.
 */
export async function runsPerDayChart(
  window: StatsWindow,
): Promise<ChartPayload> {
  const [current, comparedBuckets, compared] = await Promise.all([
    windowTally(window, false),
    comparedBucketCounts(window),
    comparedTally(window, false),
  ]);
  const starts = bucketStarts(window);
  const point =
    (count: (bucket: Tally) => number) => (bucket: Tally, i: number) => ({
      x: starts[i]!.toISOString(),
      y: count(bucket),
    });
  const chart: ChartPayload = {
    value: current.total.total,
    series: [
      {
        name: "$dms_automation.overview.succeeded",
        data: current.buckets.map(point((b) => b.ok)),
      },
      {
        name: "$dms_automation.overview.failedRuns",
        data: current.buckets.map(point((b) => b.failed)),
      },
    ],
  };
  if (!comparedBuckets) return chart;
  const { previousValue, delta } = kpiPayload("runs", current, compared);
  if (previousValue !== undefined) chart.previousValue = previousValue;
  if (isNumber(delta)) chart.delta = delta;
  chart.comparisonSeries = [comparedRunsSeries(comparedBuckets, starts)];
  return chart;
}
