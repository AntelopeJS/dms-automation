import { GetModel } from "@antelopejs/interface-database-decorators";
import type { BlockText } from "@antelopejs/interface-dms/base/types";
import { hasTrigger } from "../../runtime/graphIssues";
import {
  parseGraphSafe,
  type StepName,
  stepName,
  type TriggerSummary,
  triggersOf,
} from "../../runtime/describe";
import { triggerText, triggerTypeText } from "../../runtime/wording";
import {
  byProcedure,
  type HealthProcedure,
  type HealthRun,
  type ProcedureHealth,
  type ProcedureState,
  procedureHealth,
  runsBetween,
} from "../../stats/health";
import { DATABASE_NAME, MS_PER_DAY } from "../../types/constants";
import type { ProcedureGraph } from "../../types/graph";
import { isProductionRun } from "../../types/runLog";
import type { Procedure } from "../tables/procedure.table";
import { ProcedureModel } from "./procedure.model";
import { type StatsRun, ProcedureRunModel } from "./procedure_run.model";

/**
 * How far back the last run and the failure streak of a procedure are read,
 * whatever the window: a procedure that last ran three weeks ago and failed is
 * still failing. Matches the default run retention.
 */
const LOOKBACK_MS = 30 * MS_PER_DAY;

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
export interface ProcedureFacts {
  procedure: Procedure;
  graph: ProcedureGraph | undefined;
  triggers: TriggerSummary[];
}

/** Everything a stats answer is computed from. */
export interface StatsContext {
  now: Date;
  procedures: ProcedureFacts[];
  byId: Map<string, ProcedureFacts>;
  /** Production runs since the lookback, newest first. */
  runs: StatsRun[];
}

function factsOf(procedure: Procedure): ProcedureFacts {
  const graph = parseGraphSafe(procedure.graph);
  return { procedure, graph, triggers: graph ? triggersOf(graph) : [] };
}

/** Load the procedures and the production runs a stats answer needs. */
export async function loadStatsContext(
  earliest?: Date,
  now: Date = new Date(),
): Promise<StatsContext> {
  const procedures = (
    await GetModel(ProcedureModel, DATABASE_NAME)
      .table.orderBy("updated_at", "desc")
      .run()
  ).map(factsOf);
  const lookback = new Date(now.getTime() - LOOKBACK_MS);
  const since = earliest && earliest < lookback ? earliest : lookback;
  const runs = (
    await GetModel(ProcedureRunModel, DATABASE_NAME).listForStats(since)
  ).filter((r) => isProductionRun(r.kind));
  return {
    now,
    procedures,
    byId: new Map(procedures.map((p) => [p.procedure._id, p])),
    runs,
  };
}

/** Health of every procedure over the state window, keyed by id. */
export function healthByProcedure(
  ctx: StatsContext,
  since: Date = new Date(ctx.now.getTime() - STATE_WINDOW_MS),
): Map<string, ProcedureHealth> {
  const runsOf = byProcedure(ctx.runs as HealthRun[]);
  const out = new Map<string, ProcedureHealth>();
  for (const facts of ctx.procedures) {
    const { procedure, graph } = facts;
    const subject: HealthProcedure = {
      _id: procedure._id,
      enabled: procedure.enabled,
      hasTrigger: graph ? hasTrigger(graph) : false,
    };
    if (procedure.pausedAt) subject.pausedAt = procedure.pausedAt;
    out.set(
      procedure._id,
      procedureHealth(subject, runsOf.get(procedure._id) ?? [], since),
    );
  }
  return out;
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

/** Production runs inside a window. */
export function windowRuns(ctx: StatsContext, window: StatsWindow): StatsRun[] {
  return runsBetween(ctx.runs, window.from, window.to);
}

/** Production runs inside the compared window, when there is one. */
export function compareRuns(
  ctx: StatsContext,
  window: StatsWindow,
): StatsRun[] | undefined {
  if (!window.compareFrom || !window.compareTo) return undefined;
  return runsBetween(ctx.runs, window.compareFrom, window.compareTo);
}

/** One row of the procedures list. */
export interface ProcedureSummaryRow {
  procedureId: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Type id of the first trigger, `null` for a draft. */
  trigger: string | null;
  /** The first trigger, structured. */
  triggerSummary: TriggerSummary | null;
  /** The first trigger in words, the first line of its cell. */
  triggerText: BlockText;
  /** The first trigger's type, under its settings; `null` when the text names it. */
  triggerTypeText: BlockText | null;
  /** How many triggers the graph has. */
  triggerCount: number;
  status: ProcedureState;
  /** Why the procedure is failing or degraded, under its status pill. */
  statusDetail: string;
  lastRunAt: string | null;
  lastRunId: string | null;
  /** The last statuses, oldest first, for the `automation:last-runs` display. */
  lastRuns: string[];
  successRate: number | null;
  avgDurationMs: number | null;
  runs: number;
  failed: number;
  failingSince: string | null;
  failedStep: StepName | null;
  version: number;
  updatedAt: string | null;
}

/** The error of the last failure, for a failing or degraded procedure. */
function statusDetailOf(
  health: ProcedureHealth,
  lastFailed: StatsRun | undefined,
): string {
  const explained = health.state === "failing" || health.state === "degraded";
  return explained ? (lastFailed?.errorMessage ?? "") : "";
}

function summaryRow(
  ctx: StatsContext,
  facts: ProcedureFacts,
  health: ProcedureHealth,
): ProcedureSummaryRow {
  const { procedure, triggers } = facts;
  const lastFailed = ctx.runs.find(
    (r) => r.procedureId === procedure._id && r.status === "failed",
  );
  return {
    procedureId: procedure._id,
    name: procedure.name,
    description: procedure.description ?? "",
    enabled: procedure.enabled,
    trigger: triggers[0]?.typeId ?? null,
    triggerSummary: triggers[0] ?? null,
    triggerText: triggerText(triggers[0]),
    triggerTypeText: triggerTypeText(triggers[0]),
    triggerCount: triggers.length,
    status: health.state,
    statusDetail: statusDetailOf(health, lastFailed),
    lastRunAt: health.lastRun
      ? new Date(health.lastRun.startedAt).toISOString()
      : null,
    lastRunId: health.lastRun?._id ?? null,
    lastRuns: health.lastStatuses,
    successRate: health.successRate,
    avgDurationMs: health.avgDurationMs,
    runs: health.runs,
    failed: health.failed,
    failingSince: health.failingSince?.toISOString() ?? null,
    failedStep:
      health.state === "failing" && health.lastRun
        ? (failedStepOf(ctx, health.lastRun as StatsRun) ?? null)
        : null,
    version: procedure.version ?? 1,
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
  const health = healthByProcedure(ctx);
  return ctx.procedures.map((facts) =>
    summaryRow(ctx, facts, health.get(facts.procedure._id)!),
  );
}

/** One procedure's row, without the summary of every other one. */
export async function getProcedureSummary(
  procedureId: string,
  now: Date = new Date(),
): Promise<ProcedureSummaryRow | undefined> {
  const ctx = await loadStatsContext(undefined, now);
  const facts = ctx.byId.get(procedureId);
  if (!facts) return undefined;
  const health = healthByProcedure({
    ...ctx,
    procedures: [facts],
    runs: ctx.runs.filter((r) => r.procedureId === procedureId),
  });
  return summaryRow(ctx, facts, health.get(procedureId)!);
}
