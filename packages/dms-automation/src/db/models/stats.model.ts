import { GetModel } from "@antelopejs/interface-database-decorators";
import type { CellSublineValue } from "@antelopejs/interface-dms/base/table-view";
import type {
  BlockText,
  ComposedText,
} from "@antelopejs/interface-dms/base/types";
import { hasTrigger } from "../../runtime/graphIssues";
import {
  parseGraphSafe,
  type StepName,
  stepName,
  type TriggerSummary,
  triggersOf,
} from "../../runtime/describe";
import { retentionCutoff, runsKeptDays } from "../../runtime/retention";
import { armErrorOf } from "../../runtime/armErrors";
import {
  asParam,
  stepText,
  triggerText,
  triggerTypeText,
} from "../../runtime/wording";
import {
  type FailureStreak,
  type HealthProcedure,
  type ProcedureHealth,
  type ProcedureState,
  procedureHealth,
  RECENT_RUNS,
  streakIn,
  type WindowCounts,
} from "../../stats/health";
import { DATABASE_NAME, MS_PER_DAY } from "../../types/constants";
import type { ProcedureGraph } from "../../types/graph";
import type { Procedure } from "../tables/procedure.table";
import { ProcedureModel } from "./procedure.model";
import {
  type StatsQuery,
  type StatsRun,
  ProcedureRunModel,
} from "./procedure_run.model";

/**
 * How far back the last run and the failure streak of a procedure are read,
 * whatever the window: a procedure that last ran three weeks ago and failed is
 * still failing. As far back as runs are kept (`runs.retentionDays`), every
 * run when they are kept forever.
 */
function lookbackStart(now: Date): Date {
  const days = runsKeptDays();
  return days > 0 ? retentionCutoff(days, now) : new Date(0);
}

/** The window the procedure states and the list figures are computed over. */
const STATE_WINDOW_MS = 7 * MS_PER_DAY;

/** A time window, with the window it is compared to. */
export interface StatsWindow {
  from: Date;
  to: Date;
  compareFrom?: Date;
  compareTo?: Date;
}

/** Raw period query parameters, as the DMS period scope appends them. */
export interface PeriodQuery {
  from?: string;
  to?: string;
  compareFrom?: string;
  compareTo?: string;
}

function validDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The window a period query asks for. Without one: the last 7 days, compared
 * with the 7 days before, which is what a widget fetching before its period
 * scope resolves reads.
 */
export function windowOf(
  query: PeriodQuery,
  now: Date = new Date(),
): StatsWindow {
  const to = validDate(query.to) ?? now;
  const from =
    validDate(query.from) ?? new Date(to.getTime() - STATE_WINDOW_MS);
  const window: StatsWindow = { from, to };
  const compareFrom = validDate(query.compareFrom);
  const compareTo = validDate(query.compareTo);
  if (compareFrom && compareTo) {
    window.compareFrom = compareFrom;
    window.compareTo = compareTo;
  }
  return window;
}

/** A procedure with what its graph says, parsed once. */
interface ProcedureFacts {
  procedure: Procedure;
  graph: ProcedureGraph | undefined;
  triggers: TriggerSummary[];
}

/** What the stats answers read of one procedure's production runs. */
interface ProcedureRuns {
  /** Its newest runs, newest first, at most `RECENT_RUNS`. */
  recent: StatsRun[];
  streak: FailureStreak;
  /** Its newest failed run. */
  lastFailed: StatsRun | undefined;
}

/** Everything a stats answer is computed from. */
export interface StatsContext {
  now: Date;
  /** Runs are read from here on: the lookback, or an older window's start. */
  since: Date;
  procedures: ProcedureFacts[];
  byId: Map<string, ProcedureFacts>;
  /** The production runs of each procedure, by its id. */
  runsOf: Map<string, ProcedureRuns>;
}

function factsOf(procedure: Procedure): ProcedureFacts {
  const graph = parseGraphSafe(procedure.graph);
  return { procedure, graph, triggers: graph ? triggersOf(graph) : [] };
}

function runModel(): ProcedureRunModel {
  return GetModel(ProcedureRunModel, DATABASE_NAME);
}

/**
 * The streak of a procedure whose newest runs all failed: the failed runs
 * started after its newest other run.
 */
async function longStreak(
  procedureId: string,
  from: Date,
): Promise<FailureStreak> {
  const runs = runModel();
  const [other] = await runs.newestForStats(
    { from, procedureId, exceptStatus: "failed" },
    1,
  );
  const failed: StatsQuery = {
    from,
    procedureId,
    status: "failed",
    after: other?.startedAt,
  };
  const [length, first] = await Promise.all([
    runs.countForStats(failed),
    runs.oldestForStats(failed),
  ]);
  return first ? { length, since: new Date(first.startedAt) } : { length };
}

async function lastFailedOf(
  procedureId: string,
  from: Date,
  recent: StatsRun[],
): Promise<StatsRun | undefined> {
  const inRecent = recent.find((r) => r.status === "failed");
  if (inRecent || recent.length < RECENT_RUNS) return inRecent;
  const [run] = await runModel().newestForStats(
    { from, procedureId, status: "failed" },
    1,
  );
  return run;
}

async function procedureRuns(
  procedureId: string,
  from: Date,
): Promise<ProcedureRuns> {
  const recent = await runModel().newestForStats(
    { from, procedureId },
    RECENT_RUNS,
  );
  const [streak, lastFailed] = await Promise.all([
    streakIn(recent) ?? longStreak(procedureId, from),
    lastFailedOf(procedureId, from, recent),
  ]);
  return { recent, streak, lastFailed };
}

/**
 * Load the procedures, or the one `procedureId` names, and what a stats
 * answer reads of their production runs since the lookback, or since
 * `earliest` when that is older.
 */
export async function loadStatsContext(
  earliest?: Date,
  now: Date = new Date(),
  procedureId?: string,
): Promise<StatsContext> {
  const stored = await GetModel(ProcedureModel, DATABASE_NAME)
    .table.orderBy("updated_at", "desc")
    .run();
  const procedures = (
    procedureId ? stored.filter((p) => p._id === procedureId) : stored
  ).map(factsOf);
  const lookback = lookbackStart(now);
  const since = earliest && earliest < lookback ? earliest : lookback;
  const runsOf = new Map(
    await Promise.all(
      procedures.map(
        async ({ procedure }) =>
          [procedure._id, await procedureRuns(procedure._id, since)] as const,
      ),
    ),
  );
  return {
    now,
    since,
    procedures,
    byId: new Map(procedures.map((p) => [p.procedure._id, p])),
    runsOf,
  };
}

/**
 * How many production runs of each procedure started at or after `from`,
 * one procedure's alone when given.
 */
async function countsSince(
  from: Date,
  procedureId?: string,
): Promise<Map<string, WindowCounts>> {
  const runs = runModel();
  const [all, ok, failed] = await Promise.all([
    runs.countPerProcedure({ from, procedureId }),
    runs.countPerProcedure({ from, procedureId, status: "ok" }),
    runs.countPerProcedure({ from, procedureId, status: "failed" }),
  ]);
  const counts = new Map<string, WindowCounts>();
  for (const [id, { runs: total, avgDurationMs }] of all) {
    counts.set(id, {
      runs: total,
      ok: ok.get(id)?.runs ?? 0,
      failed: failed.get(id)?.runs ?? 0,
      avgDurationMs: avgDurationMs === null ? null : Math.round(avgDurationMs),
    });
  }
  return counts;
}

const NO_RUNS: WindowCounts = {
  runs: 0,
  ok: 0,
  failed: 0,
  avgDurationMs: null,
};

/** Health of every procedure of the context over the window, keyed by id. */
export async function healthByProcedure(
  ctx: StatsContext,
  since: Date = new Date(ctx.now.getTime() - STATE_WINDOW_MS),
): Promise<Map<string, ProcedureHealth>> {
  const from = since > ctx.since ? since : ctx.since;
  const [only, ...others] = ctx.procedures;
  const counts = await countsSince(
    from,
    only && others.length === 0 ? only.procedure._id : undefined,
  );
  const out = new Map<string, ProcedureHealth>();
  for (const facts of ctx.procedures) {
    const { procedure, graph } = facts;
    const subject: HealthProcedure = {
      _id: procedure._id,
      enabled: procedure.enabled,
      hasTrigger: graph ? hasTrigger(graph) : false,
    };
    if (procedure.pausedAt) subject.pausedAt = procedure.pausedAt;
    const armError = armErrorOf(procedure);
    if (armError) subject.armError = armError;
    const runs = ctx.runsOf.get(procedure._id);
    out.set(
      procedure._id,
      procedureHealth(subject, {
        recent: runs?.recent ?? [],
        streak: runs?.streak ?? { length: 0 },
        inWindow: counts.get(procedure._id) ?? NO_RUNS,
      }),
    );
  }
  return out;
}

/** The newest failed run of a procedure since the context's start. */
export function lastFailedOfProcedure(
  ctx: StatsContext,
  procedureId: string,
): StatsRun | undefined {
  return ctx.runsOf.get(procedureId)?.lastFailed;
}

/** The newest production runs since the context's start, newest first. */
export async function newestRuns(
  ctx: StatsContext,
  count: number,
): Promise<StatsRun[]> {
  return await runModel().newestForStats({ from: ctx.since }, count);
}

/** The newest failed production run since the context's start. */
export async function newestFailedRun(
  ctx: StatsContext,
): Promise<StatsRun | undefined> {
  const [run] = await runModel().newestForStats(
    { from: ctx.since, status: "failed" },
    1,
  );
  return run;
}

/** The step a failed run stopped at, named from the procedure's graph. */
export function failedStepOf(
  ctx: StatsContext,
  run: Pick<StatsRun, "procedureId" | "failedNodeId">,
): StepName | undefined {
  if (!run.failedNodeId) return undefined;
  const graph = ctx.byId.get(run.procedureId)?.graph;
  return graph
    ? stepName(graph, run.failedNodeId)
    : { nodeId: run.failedNodeId };
}

/** Name of a procedure, or `undefined` once it was deleted. */
export function procedureNameOf(
  ctx: StatsContext,
  procedureId: string,
): string | undefined {
  return ctx.byId.get(procedureId)?.procedure.name;
}

/** A bar of the strip of last runs, linking to its trace. */
interface RecentRunCell {
  runId: string;
  status: string;
  startedAt: string;
  errorMessage: string | null;
}

/** One row of the procedures list. */
export interface ProcedureSummaryRow {
  procedureId: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Type id of the first trigger, `null` for a draft. */
  trigger: string | null;
  /** Type ids of every trigger, for the trigger filter. */
  triggerTypes: string[];
  /** The first trigger, structured. */
  triggerSummary: TriggerSummary | null;
  /** Every trigger, structured: the search reads their paths and schedules. */
  triggers: TriggerSummary[];
  /** The first trigger in words, the first line of its cell. */
  triggerText: BlockText;
  /**
   * The first trigger's type under its settings, and how many triggers
   * follow; `null` when the text names the only trigger.
   */
  triggerTypeText: BlockText | null;
  /** How many triggers the graph has. */
  triggerCount: number;
  status: ProcedureState;
  /** What the state rests on, under its status pill. */
  statusDetail: CellSublineValue | null;
  /** Why a trigger failed to arm, else the error of the last failed run. */
  lastError: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  /** The last runs, oldest first, for the `automation:last-runs` display. */
  lastRuns: RecentRunCell[];
  successRate: number | null;
  avgDurationMs: number | null;
  runs: number;
  failed: number;
  failingSince: string | null;
  failedStep: StepName | null;
  version: number;
  updatedAt: string | null;
}

const DETAIL = "dms_automation.procedures.detail";

/**
 * Under the type of the first trigger, how many more the procedure has
 * ("Webhook · +2 more"): the cell names only the first one.
 */
function triggersTypeText(triggers: TriggerSummary[]): BlockText | null {
  const typeText = triggerTypeText(triggers[0]);
  const more = triggers.length - 1;
  if (more < 1) return typeText;
  const count = { type: "count", value: more } as const;
  return typeText
    ? {
        key: `${DETAIL}.moreTriggers`,
        params: { type: asParam(typeText), count },
      }
    : { key: `${DETAIL}.moreTriggersOnly`, params: { count } };
}

/** The error a run failed with, or "Run failed" when it gave none. */
function errorParam(message: string | undefined): BlockText {
  return message || { key: `${DETAIL}.runFailed` };
}

/**
 * Why a failing procedure fails: the trigger that cannot arm, or the error of
 * its last run, the step it stopped at and since when it fails.
 */
function failingDetail(
  health: ProcedureHealth,
  failedStep: StepName | null,
): ComposedText {
  if (health.armError) {
    const { code, params } = health.armError;
    return {
      key: `${DETAIL}.triggerError`,
      params: {
        error: { key: `dms_automation.editor.problems.codes.${code}`, params },
      },
    };
  }
  const step = stepText(failedStep);
  const params = {
    error: errorParam(health.lastRun?.errorMessage),
    count: { type: "count", value: health.failureStreak } as const,
    since: {
      type: "relative",
      value: (health.failingSince ?? new Date()).toISOString(),
    } as const,
  };
  return step
    ? { key: `${DETAIL}.failingAt`, params: { ...params, step: asParam(step) } }
    : { key: `${DETAIL}.failing`, params };
}

/**
 * The line under the status pill: why it fails, how many runs failed in the
 * window of a degraded one, or that an enabled one never ran yet (healthy,
 * as no failure was seen, but nothing proves it works either).
 */
function statusDetailOf(
  health: ProcedureHealth,
  lastFailed: StatsRun | undefined,
  failedStep: StepName | null,
): CellSublineValue | null {
  switch (health.state) {
    case "failing":
      return failingDetail(health, failedStep);
    case "degraded":
      return {
        key: `${DETAIL}.degraded`,
        params: {
          failed: health.failed,
          runs: health.runs,
          error: errorParam(lastFailed?.errorMessage),
        },
      };
    case "healthy":
      return health.lastRun
        ? null
        : { text: `$${DETAIL}.noRunYet`, tone: "muted" };
    default:
      return null;
  }
}

/**
 * A success rate in whole percents, rounded down: one failure in 300 runs
 * reads 99%, never a perfect 100%.
 */
function wholePercent(rate: number | null): number | null {
  return rate === null ? null : Math.floor(rate * 100) / 100;
}

function summaryRow(
  ctx: StatsContext,
  facts: ProcedureFacts,
  health: ProcedureHealth,
): ProcedureSummaryRow {
  const { procedure, triggers } = facts;
  const lastFailed = lastFailedOfProcedure(ctx, procedure._id);
  const failedStep =
    health.state === "failing" && health.lastRun?.status === "failed"
      ? (failedStepOf(ctx, health.lastRun) ?? null)
      : null;
  return {
    procedureId: procedure._id,
    name: procedure.name,
    description: procedure.description ?? "",
    enabled: procedure.enabled,
    trigger: triggers[0]?.typeId ?? null,
    triggerTypes: [...new Set(triggers.map((t) => t.typeId))],
    triggerSummary: triggers[0] ?? null,
    triggers,
    triggerText: triggerText(triggers[0]),
    triggerTypeText: triggersTypeText(triggers),
    triggerCount: triggers.length,
    status: health.state,
    statusDetail: statusDetailOf(health, lastFailed, failedStep),
    lastError: health.triggerError ?? lastFailed?.errorMessage ?? null,
    lastRunAt: health.lastRun
      ? new Date(health.lastRun.startedAt).toISOString()
      : null,
    lastRunId: health.lastRun?._id ?? null,
    lastRuns: health.recentRuns.map((r) => ({
      runId: r._id,
      status: r.status,
      startedAt: new Date(r.startedAt).toISOString(),
      errorMessage: r.errorMessage ?? null,
    })),
    successRate: wholePercent(health.successRate),
    avgDurationMs: health.avgDurationMs,
    runs: health.runs,
    failed: health.failed,
    failingSince: health.failingSince?.toISOString() ?? null,
    failedStep,
    version: procedure.version,
    updatedAt: procedure.updated_at
      ? new Date(procedure.updated_at).toISOString()
      : null,
  };
}

/** The procedures list: one row per procedure, its state over 7 days. */
export async function getProceduresSummary(
  now: Date = new Date(),
): Promise<ProcedureSummaryRow[]> {
  const ctx = await loadStatsContext(undefined, now);
  const health = await healthByProcedure(ctx);
  return ctx.procedures.map((facts) =>
    summaryRow(ctx, facts, health.get(facts.procedure._id)!),
  );
}

/** One procedure's row, without the summary of every other one. */
export async function getProcedureSummary(
  procedureId: string,
  now: Date = new Date(),
): Promise<ProcedureSummaryRow | undefined> {
  const ctx = await loadStatsContext(undefined, now, procedureId);
  const facts = ctx.byId.get(procedureId);
  if (!facts) return undefined;
  const health = await healthByProcedure(ctx);
  return summaryRow(ctx, facts, health.get(procedureId)!);
}
