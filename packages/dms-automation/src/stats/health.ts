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

/** How many of a procedure's newest runs its health reads. */
export const RECENT_RUNS = 12;

/** Failed runs in a row, ending with the newest run. */
export interface FailureStreak {
  length: number;
  /** When the first of them started. */
  since?: Date;
}

/** How many runs of a procedure started in a window, and how long they took. */
export interface WindowCounts {
  runs: number;
  ok: number;
  failed: number;
  avgDurationMs: number | null;
}

/** What the health rules read of a procedure's production runs. */
export interface RunsDigest {
  /** Its newest runs, newest first, at most `RECENT_RUNS`. */
  recent: HealthRun[];
  streak: FailureStreak;
  /** Its runs started in the window. */
  inWindow: WindowCounts;
}

export function timeOf(value: Date | string): number {
  return new Date(value).getTime();
}

/** When a run started and ended, and how. */
export type TimedRun = Pick<HealthRun, "startedAt" | "endedAt" | "status">;

export function durationOf(run: TimedRun): number | null {
  return run.endedAt ? timeOf(run.endedAt) - timeOf(run.startedAt) : null;
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

/**
 * The failure streak a procedure's newest runs show, newest first; `undefined`
 * when all of `RECENT_RUNS` runs failed, as the streak may reach further back.
 */
export function streakIn(
  recent: readonly HealthRun[],
): FailureStreak | undefined {
  const end = recent.findIndex((run) => run.status !== "failed");
  if (end === -1 && recent.length >= RECENT_RUNS) return undefined;
  const streak = end === -1 ? recent : recent.slice(0, end);
  const first = streak.at(-1);
  return first
    ? { length: streak.length, since: new Date(first.startedAt) }
    : { length: 0 };
}

/** Never enabled (just created or imported, nothing ran): still a draft. */
function stateOf(
  procedure: HealthProcedure,
  lastRun: HealthRun | undefined,
  failedInWindow: number,
): ProcedureState {
  if (!procedure.hasTrigger) return "draft";
  if (!procedure.enabled) {
    return procedure.pausedAt || lastRun ? "paused" : "draft";
  }
  if (procedure.armError || lastRun?.status === "failed") return "failing";
  return failedInWindow > 0 ? "degraded" : "healthy";
}

/**
 * Health of one procedure: the last run and the failure streak whatever the
 * window, the counts over the window.
 */
export function procedureHealth(
  procedure: HealthProcedure,
  { recent, streak, inWindow }: RunsDigest,
): ProcedureHealth {
  const { runs, ok, failed, avgDurationMs } = inWindow;
  const lastRun = recent[0];
  const health: ProcedureHealth = {
    state: stateOf(procedure, lastRun, failed),
    runs,
    ok,
    failed,
    successRate: ok + failed > 0 ? ok / (ok + failed) : null,
    avgDurationMs,
    failureStreak: streak.length,
    recentRuns: recent.slice(0, RECENT_RUNS).reverse(),
  };
  if (lastRun) health.lastRun = lastRun;
  if (procedure.armError) {
    health.armError = procedure.armError;
    health.triggerError = procedure.armError.message;
  }
  if (streak.since) health.failingSince = streak.since;
  return health;
}

/** How many runs of a set ended each way. */
export interface RunCounts {
  total: number;
  ok: number;
  failed: number;
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
