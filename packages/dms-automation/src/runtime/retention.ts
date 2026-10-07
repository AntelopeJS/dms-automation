import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import { DATABASE_NAME, MS_PER_DAY, MS_PER_HOUR } from "../types/constants";

/** How long runs are kept unless the project says otherwise. */
export const DEFAULT_RETENTION_DAYS = 30;

/** How often the leader purges the runs past retention. */
const PURGE_INTERVAL_MS = MS_PER_HOUR;

let timer: ReturnType<typeof setInterval> | undefined;

/** Runs started before this date are past retention. */
export function retentionCutoff(retentionDays: number, now: Date): Date {
  return new Date(now.getTime() - retentionDays * MS_PER_DAY);
}

async function purge(retentionDays: number): Promise<void> {
  const cutoff = retentionCutoff(retentionDays, new Date());
  const deleted = await GetModel(ProcedureRunModel, DATABASE_NAME).purgeBefore(
    cutoff,
  );
  if (deleted > 0) {
    Logging.Info(
      `[dms-automation] purged ${deleted} runs older than ${retentionDays} days`,
    );
  }
}

/**
 * Purge the runs older than `retentionDays` now and every hour after, on the
 * instance `isLeader` names (every instance in standalone mode). `0` keeps
 * every run.
 */
export function startRetention(
  retentionDays: number,
  isLeader: () => boolean,
): void {
  stopRetention();
  if (retentionDays <= 0) return;
  const tick = () => {
    if (!isLeader()) return;
    purge(retentionDays).catch((err: unknown) => {
      Logging.Error("[dms-automation] run retention purge failed:", err);
    });
  };
  tick();
  timer = setInterval(tick, PURGE_INTERVAL_MS);
  // The purge must never keep the process alive on shutdown.
  timer.unref?.();
}

export function stopRetention(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
