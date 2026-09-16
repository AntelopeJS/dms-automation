import { GetModel } from "@antelopejs/interface-database-decorators";
import { registry } from "../../runtime/registry";
import { DATABASE_NAME, MS_PER_DAY } from "../../types/constants";
import type { Procedure } from "../tables/procedure.table";
import type { StatsRun as ProcedureRun } from "./procedure_run.model";
import { AutomationTemplateModel } from "./automation_template.model";
import { ProcedureModel } from "./procedure.model";
import { ProcedureRunModel } from "./procedure_run.model";

type Window = "24h" | "7d";

// Look-back span for each health window, replacing an if/else on `windowStr`.
const WINDOW_MS: Record<Window, number> = {
  "24h": MS_PER_DAY,
  "7d": 7 * MS_PER_DAY,
};

function startOf(windowStr: Window, now: Date): Date {
  const d = new Date(now);
  d.setMilliseconds(0);
  d.setTime(d.getTime() - WINDOW_MS[windowStr]);
  return d;
}

interface HealthBucket {
  total: number;
  ok: number;
  failed: number;
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export interface StatsSnapshot {
  counts: {
    procedures: { total: number; enabled: number; disabled: number };
    triggerTypes: number;
    actionTypes: number;
    dataNodeTypes: number;
    templates: number;
  };
  health: {
    "24h": HealthBucket;
    "7d": HealthBucket;
  };
  runsPerDay7d: Array<{ day: string; ok: number; failed: number }>;
  recentFailures: Array<{
    runId: string;
    procedureId: string;
    procedureName: string;
    startedAt: string;
    errorMessage: string;
  }>;
  topProcedures7d: Array<{
    procedureId: string;
    name: string;
    runs: number;
    ok: number;
    failed: number;
  }>;
  // Latest runs across all statuses (ok | failed), newest first — drives the
  // "Recent runs" feed on the overview.
  recentRuns: Array<{
    runId: string;
    procedureId: string;
    procedureName: string;
    status: string;
    startedAt: string;
    durationMs: number | null;
  }>;
  // Procedures that need attention: disabled ("paused") procedures and
  // procedures with failed runs over the 7-day window ("failing"). Drives the
  // "Failing or paused procedures" panel.
  needsAttention: Array<{
    procedureId: string;
    name: string;
    kind: "paused" | "failing";
    failed: number;
    lastRunAt: string | null;
  }>;
}

/** Per-procedure run tallies over the stats window. */
interface RunAgg {
  runs: number;
  ok: number;
  failed: number;
}

function computeHealthBucket(
  runs: ProcedureRun[],
  fromDate: Date,
): HealthBucket {
  const inWindow = runs.filter((r) => new Date(r.startedAt) >= fromDate);
  const ok = inWindow.filter((r) => r.status === "ok").length;
  const failed = inWindow.filter((r) => r.status === "failed").length;
  const total = ok + failed;
  const durations = inWindow
    .filter((r) => r.endedAt)
    .map(
      (r) => new Date(r.endedAt!).getTime() - new Date(r.startedAt).getTime(),
    );
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  let p95DurationMs = 0;
  if (durations.length) {
    const sorted = [...durations].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.ceil(0.95 * sorted.length) - 1,
    );
    p95DurationMs = Math.round(sorted[Math.max(0, idx)]!);
  }
  return {
    total,
    ok,
    failed,
    successRate: total ? ok / total : 0,
    avgDurationMs,
    p95DurationMs,
  };
}

function buildRunsPerDay(
  allRuns: ProcedureRun[],
  now: Date,
): StatsSnapshot["runsPerDay7d"] {
  const out: StatsSnapshot["runsPerDay7d"] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayRuns = allRuns.filter((r) => {
      const t = new Date(r.startedAt);
      return t >= dayStart && t < dayEnd;
    });
    out.push({
      day: dayStart.toISOString().slice(0, 10),
      ok: dayRuns.filter((r) => r.status === "ok").length,
      failed: dayRuns.filter((r) => r.status === "failed").length,
    });
  }
  return out;
}

function buildRecentFailures(
  allRuns: ProcedureRun[],
  procById: Map<string, Procedure>,
): StatsSnapshot["recentFailures"] {
  return allRuns
    .filter((r) => r.status === "failed")
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )
    .slice(0, 10)
    .map((r) => ({
      runId: r._id,
      procedureId: r.procedureId,
      procedureName: procById.get(r.procedureId)?.name ?? "(deleted)",
      startedAt: new Date(r.startedAt).toISOString(),
      errorMessage: r.errorMessage ?? "",
    }));
}

function aggregateByProcedure(allRuns: ProcedureRun[]): Map<string, RunAgg> {
  const perProc = new Map<string, RunAgg>();
  for (const r of allRuns) {
    const cur = perProc.get(r.procedureId) ?? { runs: 0, ok: 0, failed: 0 };
    cur.runs++;
    if (r.status === "ok") cur.ok++;
    else if (r.status === "failed") cur.failed++;
    perProc.set(r.procedureId, cur);
  }
  return perProc;
}

function buildTopProcedures(
  perProc: Map<string, RunAgg>,
  procById: Map<string, Procedure>,
): StatsSnapshot["topProcedures7d"] {
  return [...perProc.entries()]
    .map(([procedureId, c]) => ({
      procedureId,
      name: procById.get(procedureId)?.name ?? "(deleted)",
      ...c,
    }))
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 10);
}

function buildRecentRuns(
  allRuns: ProcedureRun[],
  procById: Map<string, Procedure>,
): StatsSnapshot["recentRuns"] {
  return [...allRuns]
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )
    .slice(0, 8)
    .map((r) => ({
      runId: r._id,
      procedureId: r.procedureId,
      procedureName: procById.get(r.procedureId)?.name ?? "(deleted)",
      status: r.status,
      startedAt: new Date(r.startedAt).toISOString(),
      durationMs: r.endedAt
        ? new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()
        : null,
    }));
}

function lastRunByProcedure(allRuns: ProcedureRun[]): Map<string, string> {
  const lastRunByProc = new Map<string, string>();
  for (const r of allRuns) {
    const iso = new Date(r.startedAt).toISOString();
    const prev = lastRunByProc.get(r.procedureId);
    if (!prev || iso > prev) lastRunByProc.set(r.procedureId, iso);
  }
  return lastRunByProc;
}

function buildNeedsAttention(
  procedures: Procedure[],
  perProc: Map<string, RunAgg>,
  lastRunByProc: Map<string, string>,
  procById: Map<string, Procedure>,
): StatsSnapshot["needsAttention"] {
  const out: StatsSnapshot["needsAttention"] = [];
  // Paused: disabled procedures. "Disabled" takes precedence over failures so a
  // procedure's status matches getProceduresSummary (the Procedures page) —
  // disabled ⇒ paused, enabled-with-failures ⇒ failing.
  const pausedIds = new Set<string>();
  for (const p of procedures) {
    if (!p.enabled) {
      out.push({
        procedureId: p._id,
        name: p.name,
        kind: "paused",
        failed: perProc.get(p._id)?.failed ?? 0,
        lastRunAt: lastRunByProc.get(p._id) ?? null,
      });
      pausedIds.add(p._id);
    }
  }
  // Failing: enabled procedures with at least one failed run over the 7d window.
  for (const [procedureId, c] of perProc) {
    if (c.failed > 0 && !pausedIds.has(procedureId)) {
      out.push({
        procedureId,
        name: procById.get(procedureId)?.name ?? "(deleted)",
        kind: "failing",
        failed: c.failed,
        lastRunAt: lastRunByProc.get(procedureId) ?? null,
      });
    }
  }
  // Failing first (most failures), then paused.
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "failing" ? -1 : 1;
    return b.failed - a.failed;
  });
  return out;
}

function buildCounts(
  procedures: Procedure[],
  templatesCount: number,
): StatsSnapshot["counts"] {
  return {
    procedures: {
      total: procedures.length,
      enabled: procedures.filter((p) => p.enabled).length,
      disabled: procedures.filter((p) => !p.enabled).length,
    },
    triggerTypes: registry.listTriggers().length,
    actionTypes: registry.listActions().length,
    dataNodeTypes: registry.listDataNodes().length,
    templates: templatesCount,
  };
}

export async function getStatsSnapshot(
  now: Date = new Date(),
): Promise<StatsSnapshot> {
  const procedureModel = GetModel(ProcedureModel, DATABASE_NAME);
  const runModel = GetModel(ProcedureRunModel, DATABASE_NAME);

  const procedures = await procedureModel.table
    .orderBy("updated_at", "desc")
    .run();
  const procById = new Map(procedures.map((p) => [p._id, p]));

  const since7 = startOf("7d", now);
  const allRuns = await runModel.listForStats(since7);

  const perProc = aggregateByProcedure(allRuns);
  const lastRunByProc = lastRunByProcedure(allRuns);

  const tplModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
  const templatesCount = await tplModel.table.count().run();

  return {
    counts: buildCounts(procedures, templatesCount),
    health: {
      "24h": computeHealthBucket(allRuns, startOf("24h", now)),
      "7d": computeHealthBucket(allRuns, since7),
    },
    runsPerDay7d: buildRunsPerDay(allRuns, now),
    recentFailures: buildRecentFailures(allRuns, procById),
    topProcedures7d: buildTopProcedures(perProc, procById),
    recentRuns: buildRecentRuns(allRuns, procById),
    needsAttention: buildNeedsAttention(
      procedures,
      perProc,
      lastRunByProc,
      procById,
    ),
  };
}

export interface ProcedureSummaryRow {
  procedureId: string;
  name: string;
  enabled: boolean;
  // Trigger node typeId from the procedure graph (e.g. "manual", "cron"); null
  // if the graph has no trigger / can't be parsed.
  trigger: string | null;
  status: "active" | "paused" | "failing";
  lastRunAt: string | null;
  successRate: number;
  avgDurationMs: number;
  runs: number;
}

function triggerTypeOf(graphStr: string): string | null {
  try {
    const g = JSON.parse(graphStr) as {
      nodes?: Array<{ kind?: string; typeId?: string }>;
    };
    const nodes = Array.isArray(g.nodes) ? g.nodes : [];
    const trigger = nodes.find((n) => n.kind === "trigger");
    return trigger?.typeId ?? null;
  } catch {
    return null;
  }
}

// Per-procedure rows for the dedicated Procedures list page: trigger, status
// (active | paused | failing), last run, success rate and avg duration over the
// 7-day window.
export async function getProceduresSummary(
  now: Date = new Date(),
): Promise<ProcedureSummaryRow[]> {
  const procedureModel = GetModel(ProcedureModel, DATABASE_NAME);
  const runModel = GetModel(ProcedureRunModel, DATABASE_NAME);

  const procedures = await procedureModel.table
    .orderBy("updated_at", "desc")
    .run();

  const since7 = startOf("7d", now);
  const allRuns = await runModel.listForStats(since7);

  interface Agg {
    runs: number;
    ok: number;
    failed: number;
    durSum: number;
    durN: number;
    last: string | null;
  }
  const agg = new Map<string, Agg>();
  for (const r of allRuns) {
    const a = agg.get(r.procedureId) ?? {
      runs: 0,
      ok: 0,
      failed: 0,
      durSum: 0,
      durN: 0,
      last: null,
    };
    a.runs++;
    if (r.status === "ok") a.ok++;
    else if (r.status === "failed") a.failed++;
    if (r.endedAt) {
      a.durSum +=
        new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime();
      a.durN++;
    }
    const iso = new Date(r.startedAt).toISOString();
    if (!a.last || iso > a.last) a.last = iso;
    agg.set(r.procedureId, a);
  }

  return procedures.map((p) => {
    const a = agg.get(p._id);
    const ok = a?.ok ?? 0;
    const failed = a?.failed ?? 0;
    const total = ok + failed;
    const status: ProcedureSummaryRow["status"] = !p.enabled
      ? "paused"
      : failed > 0
        ? "failing"
        : "active";
    return {
      procedureId: p._id,
      name: p.name,
      enabled: p.enabled,
      trigger: triggerTypeOf(p.graph),
      status,
      lastRunAt: a?.last ?? null,
      successRate: total ? ok / total : 0,
      avgDurationMs: a && a.durN ? Math.round(a.durSum / a.durN) : 0,
      runs: a?.runs ?? 0,
    };
  });
}
