import {
  compareRuns,
  failedStepOf,
  healthByProcedure,
  procedureNameOf,
  type StatsContext,
  type StatsWindow,
  windowRuns,
} from "../db/models/stats.model";
import type { StatsRun } from "../db/models/procedure_run.model";
import { type StepName, stepTitle } from "../runtime/describe";
import {
  deltaPercent,
  durationOf,
  type ProcedureHealth,
  type ProcedureState,
  runFigures,
  type RunFigures,
  stateRank,
  timeOf,
} from "./health";
import { bucketStarts, runsPerBucket } from "./kpi";

/** The last failure, as the overview links to it. */
export interface FailureRef {
  runId: string;
  procedureId: string;
  procedureName: string;
  startedAt: string;
  error: string;
  step: StepName | null;
}

/** A failing procedure in the overview's health line. */
export interface FailingProcedure {
  procedureId: string;
  name: string;
  since: string | null;
  streak: number;
  lastRunId: string | null;
}

/** What the overview's health line says. */
export type OverallState =
  | "empty"
  | "failing"
  | "degraded"
  | "healthy"
  | "idle";

export interface HealthHero {
  state: OverallState;
  updatedAt: string;
  procedures: number;
  enabled: number;
  failing: FailingProcedure[];
  degraded: number;
  paused: number;
  figures: RunFigures;
  lastFailure: FailureRef | null;
}

function failureRef(ctx: StatsContext, run: StatsRun): FailureRef {
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
  figures: RunFigures,
): OverallState {
  if (procedures === 0) return "empty";
  if (states.includes("failing")) return "failing";
  if (states.includes("degraded")) return "degraded";
  return figures.total > 0 ? "healthy" : "idle";
}

/** The overview's one-line state, over the selected window. */
export function healthHero(ctx: StatsContext, window: StatsWindow): HealthHero {
  const health = healthByProcedure(ctx);
  const states = [...health.values()].map((h) => h.state);
  const figures = runFigures(windowRuns(ctx, window));
  const failing = ctx.procedures
    .filter((p) => health.get(p.procedure._id)?.state === "failing")
    .map((p) => {
      const h = health.get(p.procedure._id)!;
      return {
        procedureId: p.procedure._id,
        name: p.procedure.name,
        since: h.failingSince?.toISOString() ?? null,
        streak: h.failureStreak,
        lastRunId: h.lastRun?._id ?? null,
      };
    })
    .sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""));
  // While a procedure is failing, its failure is the one to inspect.
  const firstFailing = failing[0]?.lastRunId;
  const lastFailed =
    ctx.runs.find((r) => r._id === firstFailing) ??
    ctx.runs.find((r) => r.status === "failed");
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
export interface AttentionRow {
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
  pausedAt: string | null;
  pausedBy: string | null;
  triggerType: string | null;
}

const ATTENTION_STATES = new Set<ProcedureState>([
  "failing",
  "degraded",
  "paused",
]);

const MAX_ATTENTION_ROWS = 8;

function isDismissed(
  dismissedAt: Date | undefined,
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
  const lastFailed = ctx.runs.find(
    (r) => r.procedureId === procedureId && r.status === "failed",
  );
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
    pausedAt: procedure.pausedAt
      ? new Date(procedure.pausedAt).toISOString()
      : null,
    pausedBy: procedure.pausedBy ?? null,
    triggerType: facts.triggers[0]?.typeId ?? null,
  };
}

/**
 * The procedures that need someone: failing first, then degraded (until
 * dismissed, or until they fail again), then paused.
 */
export function attentionRows(ctx: StatsContext): AttentionRow[] {
  const health = healthByProcedure(ctx);
  const rows: AttentionRow[] = [];
  for (const facts of ctx.procedures) {
    const id = facts.procedure._id;
    const h = health.get(id);
    if (!h || !ATTENTION_STATES.has(h.state)) continue;
    const lastFailed = ctx.runs.find(
      (r) => r.procedureId === id && r.status === "failed",
    );
    const dismissed =
      h.state === "degraded" &&
      isDismissed(facts.procedure.attentionDismissedAt, lastFailed);
    if (!dismissed) rows.push(attentionRow(ctx, id, h));
  }
  return rows
    .sort(
      (a, b) => stateRank(a.state) - stateRank(b.state) || b.failed - a.failed,
    )
    .slice(0, MAX_ATTENTION_ROWS);
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

const RECENT_RUNS = 8;

/** The overview's recent runs, newest first, each linking to its trace. */
export function recentRunItems(
  ctx: StatsContext,
  traceUrl: string,
): FeedItem[] {
  return ctx.runs.slice(0, RECENT_RUNS).map((run) => {
    const failed = run.status === "failed";
    const step = failedStepOf(ctx, run);
    const params: Record<string, string> = {
      duration: formatDuration(durationOf(run)),
      error: run.errorMessage ?? "",
    };
    if (step) params.step = stepTitle(step);
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
        procedureNameOf(ctx, run.procedureId) ??
        "$dms_automation.feed.deletedProcedure",
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

/** The overview's procedure counts, each linking to its tab of the list. */
export function procedureCounts(
  ctx: StatsContext,
  proceduresUrl: string,
): KeyValueItem[] {
  const health = healthByProcedure(ctx);
  const count = (state: ProcedureState) =>
    [...health.values()].filter((h) => h.state === state).length;
  const tab = (state: string) => `${proceduresUrl}?tab=${state}`;
  return [
    {
      id: "total",
      label: "$dms_automation.overview.counts.total",
      value: ctx.procedures.length,
      to: proceduresUrl,
    },
    {
      id: "enabled",
      label: "$dms_automation.overview.counts.enabled",
      value: ctx.procedures.filter((p) => p.procedure.enabled).length,
    },
    {
      id: "failing",
      label: "$dms_automation.overview.counts.failing",
      value: count("failing"),
      type: "status",
      tone: count("failing") > 0 ? "error" : "neutral",
      to: tab("failing"),
    },
    {
      id: "paused",
      label: "$dms_automation.overview.counts.paused",
      value: count("paused"),
      to: tab("paused"),
    },
    {
      id: "draft",
      label: "$dms_automation.overview.counts.draft",
      value: count("draft"),
      to: tab("draft"),
    },
  ];
}

/** One row of a `TopListCard`. */
export interface TopListItem {
  id: string;
  title: string;
  value: number;
  description?: string;
}

/** How many procedures each trigger type starts, most used first. */
export function triggerCounts(ctx: StatsContext): TopListItem[] {
  const counts = new Map<string, TopListItem>();
  for (const facts of ctx.procedures) {
    for (const trigger of facts.triggers) {
      const item = counts.get(trigger.typeId) ?? {
        id: trigger.typeId,
        title: trigger.typeName,
        value: 0,
      };
      item.value += 1;
      counts.set(trigger.typeId, item);
    }
  }
  return [...counts.values()].sort((a, b) => b.value - a.value);
}

/** A point of a chart series. */
export interface ChartPoint {
  x: string;
  y: number;
}

/** What a `ChartCard` reads: a headline value and its series. */
export interface ChartPayload {
  value: number;
  previousValue?: number;
  delta?: number;
  series: Array<{ name: string; data: ChartPoint[] }>;
}

/** Succeeded and failed runs per bucket (hour or day) of the window. */
export function runsPerDayChart(
  ctx: StatsContext,
  window: StatsWindow,
): ChartPayload {
  const runs = windowRuns(ctx, window);
  const buckets = runsPerBucket(runs, window);
  const starts = bucketStarts(window);
  const point = (status: string) => (bucket: StatsRun[], i: number) => ({
    x: starts[i]!.toISOString(),
    y: bucket.filter((r) => r.status === status).length,
  });
  const payload: ChartPayload = {
    value: runs.length,
    series: [
      {
        name: "$dms_automation.overview.succeeded",
        data: buckets.map(point("ok")),
      },
      {
        name: "$dms_automation.overview.failedRuns",
        data: buckets.map(point("failed")),
      },
    ],
  };
  const previous = compareRuns(ctx, window);
  if (previous) {
    payload.previousValue = previous.length;
    payload.delta = deltaPercent(runs.length, previous.length);
  }
  return payload;
}
