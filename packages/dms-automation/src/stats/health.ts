/**
 * The health of procedures, computed from their runs. Pure functions over
 * plain rows, so the rules are tested without a database.
 */

import type { ArmError } from "../runtime/armErrors";

/**
 * State of a procedure:
 * - `draft`: no trigger yet, or disabled and never enabled nor run;
 * - `paused`: disabled after being enabled (or after it ran);
 * - `failing`: enabled, and its last run failed or a trigger failed to arm;
 * - `degraded`: enabled, its last run succeeded, but runs failed in the window;
 * - `healthy`: enabled, no failure in the window (a procedure that never ran
 *   yet included: the list says so under its state).
 */
export type ProcedureState =
  | "draft"
  | "paused"
  | "failing"
  | "degraded"
  | "healthy";

const PROCEDURE_STATES: readonly ProcedureState[] = [
  "failing",
  "degraded",
  "healthy",
  "paused",
  "draft",
];

/** A run as the health rules read it: production runs only. */
export interface HealthRun {
  _id: string;
  procedureId: string;
  startedAt: Date | string;
  endedAt?: Date | string;
  status: string;
  errorMessage?: string;
  failedNodeId?: string;
}

/** What the health rules know of a procedure. */
export interface HealthProcedure {
  _id: string;
  enabled: boolean;
  hasTrigger: boolean;
  /** When it was last disabled; absent for one never enabled. */
  pausedAt?: Date;
  /** Why one of its triggers failed to arm: it will never start that way. */
  armError?: ArmError;
}

/** The health of one procedure over a window. */
export interface ProcedureHealth {
  state: ProcedureState;
  runs: number;
  ok: number;
  failed: number;
  successRate: number | null;
  avgDurationMs: number | null;
  lastRun?: HealthRun;
  /** Start of the current streak of failures, when the last run failed. */
  failingSince?: Date;
  /** Number of failed runs in a row, ending with the last run. */
  failureStreak: number;
  /** Why one of its triggers failed to arm, when it is enabled. */
  armError?: ArmError;
  /** The same, as the English message the log carries. */
  triggerError?: string;
  /** The most recent runs, newest last. */
  recentRuns: HealthRun[];
}

const RECENT_RUNS = 12;

export function timeOf(value: Date | string): number {
  return new Date(value).getTime();
}

export function durationOf(run: HealthRun): number | null {
  return run.endedAt ? timeOf(run.endedAt) - timeOf(run.startedAt) : null;
}

function newestFirst(runs: readonly HealthRun[]): HealthRun[] {
  return [...runs].sort((a, b) => timeOf(b.startedAt) - timeOf(a.startedAt));
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** p-th percentile (0–1) of a list of numbers, nearest rank. */
export function percentile(
  values: readonly number[],
  p: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, rank)] ?? 0);
}

function streakOf(runs: readonly HealthRun[]): HealthRun[] {
  const streak: HealthRun[] = [];
  for (const run of runs) {
    if (run.status !== "failed") break;
    streak.push(run);
  }
  return streak;
}

function stateOf(
  procedure: HealthProcedure,
  lastRun: HealthRun | undefined,
  failedInWindow: number,
): ProcedureState {
  if (!procedure.hasTrigger) return "draft";
  if (!procedure.enabled) {
    // Never enabled (just created or imported, nothing ran): still a draft.
    return procedure.pausedAt || lastRun ? "paused" : "draft";
  }
  if (procedure.armError || lastRun?.status === "failed") return "failing";
  return failedInWindow > 0 ? "degraded" : "healthy";
}

/**
 * Health of one procedure. `runs` are its production runs, any order, over a
 * span at least as long as the window: the last run and the failure streak are
 * read from all of them, the counts from those started at or after `since`.
 */
export function procedureHealth(
  procedure: HealthProcedure,
  runs: readonly HealthRun[],
  since: Date,
): ProcedureHealth {
  const sorted = newestFirst(runs);
  const inWindow = sorted.filter((r) => timeOf(r.startedAt) >= since.getTime());
  const ok = inWindow.filter((r) => r.status === "ok").length;
  const failed = inWindow.filter((r) => r.status === "failed").length;
  const durations = inWindow
    .map(durationOf)
    .filter((d): d is number => d !== null);
  const lastRun = sorted[0];
  // A run cancelled by a module going away says nothing of the procedure: the
  // state and the failure streak come from the runs that ended on their own.
  const decided = sorted.filter((r) => r.status !== "cancelled");
  const streak = streakOf(decided);
  const health: ProcedureHealth = {
    state: stateOf(procedure, decided[0], failed),
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
    health.triggerError = procedure.armError.message;
  }
  const firstOfStreak = streak.at(-1);
  if (firstOfStreak) health.failingSince = new Date(firstOfStreak.startedAt);
  return health;
}

/** Figures of a set of runs over a window. */
export interface RunFigures {
  total: number;
  ok: number;
  failed: number;
  successRate: number | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
}

export function runFigures(runs: readonly HealthRun[]): RunFigures {
  const ok = runs.filter((r) => r.status === "ok").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const durations = runs.map(durationOf).filter((d): d is number => d !== null);
  return {
    total: runs.length,
    ok,
    failed,
    successRate: ok + failed > 0 ? ok / (ok + failed) : null,
    avgDurationMs: average(durations),
    p95DurationMs: percentile(durations, 0.95),
  };
}

/** Runs started in `[from, to]`. */
export function runsBetween<R extends HealthRun>(
  runs: readonly R[],
  from: Date,
  to: Date,
): R[] {
  const start = from.getTime();
  const end = to.getTime();
  return runs.filter((r) => {
    const t = timeOf(r.startedAt);
    return t >= start && t <= end;
  });
}

/** Group runs by procedure id. */
export function byProcedure<R extends HealthRun>(
  runs: readonly R[],
): Map<string, R[]> {
  const out = new Map<string, R[]>();
  for (const run of runs) {
    const list = out.get(run.procedureId) ?? [];
    list.push(run);
    out.set(run.procedureId, list);
  }
  return out;
}

/** Change from `previous` to `current` in percent, one decimal. */
export function deltaPercent(current: number, previous: number): number {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

const STATE_ORDER = new Map(PROCEDURE_STATES.map((s, i) => [s, i]));

/** Sort key putting the procedures that need attention first. */
export function stateRank(state: ProcedureState): number {
  return STATE_ORDER.get(state) ?? PROCEDURE_STATES.length;
}
