import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import type { ProcedureRunStatus } from "@antelopejs/interface-dms-automation";
import { MS_PER_SECOND } from "../../types/constants";
import {
  ProcedureRun,
  procedureRunsTableName,
} from "../tables/procedure_run.table";

export type StatsRun = Pick<
  ProcedureRun,
  | "_id"
  | "procedureId"
  | "procedureName"
  | "startedAt"
  | "endedAt"
  | "status"
  | "errorMessage"
  | "kind"
  | "failedNodeId"
  | "triggerNodeId"
>;

const STATS_FIELDS = [
  "_id",
  "procedureId",
  "procedureName",
  "startedAt",
  "endedAt",
  "status",
  "errorMessage",
  "kind",
  "failedNodeId",
  "triggerNodeId",
] as const;

/** The production runs a stats figure is read from. */
export interface StatsQuery {
  /** Started at or after. */
  from: Date;
  /** Started at or before. */
  to?: Date;
  /** Started strictly after. */
  after?: Date;
  procedureId?: string;
  status?: ProcedureRunStatus;
  /** Of any status but this one. */
  exceptStatus?: ProcedureRunStatus;
}

/** When a run started and ended, for the durations of a percentile. */
export type StatsTiming = Pick<
  ProcedureRun,
  "startedAt" | "endedAt" | "status"
>;

/**
 * List-view shape of a run: everything except the trigger payload and the
 * execution log, which can be large. The full run is read by id.
 */
export type RunSummary = Pick<
  ProcedureRun,
  | "_id"
  | "procedureId"
  | "procedureName"
  | "startedAt"
  | "endedAt"
  | "status"
  | "errorMessage"
  | "triggerNodeId"
  | "kind"
  | "failedNodeId"
  | "rerunOf"
>;

const RUN_SUMMARY_FIELDS = [
  "_id",
  "procedureId",
  "procedureName",
  "startedAt",
  "endedAt",
  "status",
  "errorMessage",
  "triggerNodeId",
  "kind",
  "failedNodeId",
  "rerunOf",
] as const;

/**
 * A query on the runs of a procedure a run is compared with: its tests, or
 * its production runs (`run` or `rerun`), in a time range, of one status when
 * given.
 */
export interface HistoryQuery {
  tests: boolean;
  /** Started strictly after. */
  after?: Date;
  /** Started strictly before. */
  before?: Date;
  status?: ProcedureRunStatus;
}

/** When a run started and ended, and how long it took. */
export type RunTiming = Pick<
  ProcedureRun,
  "_id" | "procedureId" | "startedAt" | "endedAt" | "status" | "durationMs"
>;

const RUN_TIMING_FIELDS = [
  "_id",
  "procedureId",
  "startedAt",
  "endedAt",
  "status",
  "durationMs",
] as const;

export class ProcedureRunModel extends BasicDataModel(
  ProcedureRun,
  procedureRunsTableName,
) {
  /** The production runs a stats query selects, test runs left out. */
  private production({
    procedureId,
    status,
    exceptStatus,
    from,
    to,
    after,
  }: StatsQuery) {
    return this.table.filter((row) => {
      let match = row.key("kind").ne("test").and(row.key("startedAt").ge(from));
      if (to) match = match.and(row.key("startedAt").le(to));
      if (after) match = match.and(row.key("startedAt").gt(after));
      if (procedureId)
        match = match.and(row.key("procedureId").eq(procedureId));
      if (status) match = match.and(row.key("status").eq(status));
      if (exceptStatus) match = match.and(row.key("status").ne(exceptStatus));
      return match;
    });
  }

  /** The newest production runs the query selects, newest first. */
  async newestForStats(query: StatsQuery, count: number): Promise<StatsRun[]> {
    return await this.production(query)
      .orderBy("startedAt", "desc")
      .slice(0, count)
      .pluck(...STATS_FIELDS)
      .run();
  }

  /** The oldest production run the query selects. */
  async oldestForStats(query: StatsQuery): Promise<StatsRun | undefined> {
    const [run] = await this.production(query)
      .orderBy("startedAt", "asc")
      .slice(0, 1)
      .pluck(...STATS_FIELDS)
      .run();
    return run;
  }

  /** How many production runs the query selects. */
  async countForStats(query: StatsQuery): Promise<number> {
    return await this.production(query).count().run();
  }

  /** How many production runs the query selects, per status. */
  async countPerStatus(query: StatsQuery): Promise<Map<string, number>> {
    const groups = await this.production(query)
      .group("status", (runs, status) => ({ status, runs: runs.count() }))
      .run();
    return new Map(groups.map((g) => [String(g.status), g.runs]));
  }

  /**
   * How many production runs the query selects, and their mean duration,
   * per procedure.
   */
  async countPerProcedure(
    query: StatsQuery,
  ): Promise<Map<string, { runs: number; avgDurationMs: number | null }>> {
    const groups = await this.production(query)
      .group("procedureId", (runs, procedureId) => ({
        procedureId,
        runs: runs.count(),
        avgDurationMs: runs.avg("durationMs"),
      }))
      .run();
    return new Map(
      groups.map((g) => [
        String(g.procedureId),
        { runs: g.runs, avgDurationMs: g.avgDurationMs ?? null },
      ]),
    );
  }

  /**
   * How many production runs the query selects per bucket of `stepMs`
   * starting at `first`, keyed by the bucket's index.
   */
  async countPerBucket(
    query: StatsQuery,
    first: Date,
    stepMs: number,
  ): Promise<Map<number, number>> {
    const firstSeconds = first.getTime() / MS_PER_SECOND;
    const groups = await this.production(query)
      .map((row) => ({
        bucket: row
          .key("startedAt")
          .epoch()
          .sub(firstSeconds)
          .mul(MS_PER_SECOND)
          .round()
          .div(stepMs)
          .floor(),
      }))
      .group("bucket", (runs, bucket) => ({ bucket, runs: runs.count() }))
      .run();
    return new Map(groups.map((g) => [Number(g.bucket), g.runs]));
  }

  /**
   * The start, end and status of every production run the query selects:
   * the one read of rows left, for a percentile of their durations.
   */
  async timingsForStats(query: StatsQuery): Promise<StatsTiming[]> {
    return await this.production(query)
      .pluck("startedAt", "endedAt", "status")
      .run();
  }

  /** Write a procedure's current name on its runs. */
  async renameProcedure(procedureId: string, name: string): Promise<number> {
    return await this.table
      .filter((row) =>
        row
          .key("procedureId")
          .eq(procedureId)
          .and(row.key("procedureName").ne(name)),
      )
      .update({ procedureName: name })
      .run();
  }

  /**
   * Write a procedure's current version on its production runs of an older
   * one that lack it, so the run list tells them apart. Called when the
   * procedure is saved. Test runs carry no version: they are left alone.
   */
  async markOlderVersions(
    procedureId: string,
    version: number,
  ): Promise<number> {
    return await this.table
      .filter((row) =>
        row
          .key("procedureId")
          .eq(procedureId)
          .and(row.key("procedureVersion").default(version).lt(version))
          .and(row.key("procedureCurrentVersion").default(0).ne(version)),
      )
      .update({ procedureCurrentVersion: version })
      .run();
  }

  /**
   * The newest run of a procedure the query matches: the last success or the
   * previous run a trace compares with, however far back.
   */
  async newest(
    procedureId: string,
    query: HistoryQuery,
  ): Promise<RunSummary | undefined> {
    const [run] = await this.history(procedureId, query)
      .orderBy("startedAt", "desc")
      .slice(0, 1)
      .pluck(...RUN_SUMMARY_FIELDS)
      .run();
    return run;
  }

  /** The oldest run of a procedure the query matches: the next run. */
  async oldest(
    procedureId: string,
    query: HistoryQuery,
  ): Promise<RunSummary | undefined> {
    const [run] = await this.history(procedureId, query)
      .orderBy("startedAt", "asc")
      .slice(0, 1)
      .pluck(...RUN_SUMMARY_FIELDS)
      .run();
    return run;
  }

  /** How many runs of a procedure the query matches. */
  async countHistory(
    procedureId: string,
    query: HistoryQuery,
  ): Promise<number> {
    return await this.history(procedureId, query).count().run();
  }

  /**
   * The timings of the successful runs of a procedure the query matches,
   * newest first, at most `limit`.
   */
  async successTimings(
    procedureId: string,
    query: HistoryQuery,
    limit: number,
  ): Promise<RunTiming[]> {
    return await this.history(procedureId, { ...query, status: "ok" })
      .orderBy("startedAt", "desc")
      .slice(0, limit)
      .pluck(...RUN_TIMING_FIELDS)
      .run();
  }

  private history(
    procedureId: string,
    { tests, after, before, status }: HistoryQuery,
  ) {
    let query = this.table.filter((row) =>
      row
        .key("procedureId")
        .eq(procedureId)
        .and(tests ? row.key("kind").eq("test") : row.key("kind").ne("test")),
    );
    if (after) query = query.filter((row) => row.key("startedAt").gt(after));
    if (before) query = query.filter((row) => row.key("startedAt").lt(before));
    if (status) query = query.filter((row) => row.key("status").eq(status));
    return query;
  }

  /** Whether any run started before `date`. */
  async hasRunBefore(date: Date): Promise<boolean> {
    const older = await this.table
      .filter((row) => row.key("startedAt").lt(date))
      .slice(0, 1)
      .pluck("_id")
      .run();
    return older.length > 0;
  }

  /** Delete the runs started before `before`; returns how many went. */
  async purgeBefore(before: Date): Promise<number> {
    return await this.table
      .filter((row) => row.key("startedAt").lt(before))
      .delete()
      .run();
  }

  /**
   * Over-fetch one extra row as a "has next page" probe. The caller trims
   * the surplus row and uses its presence to decide whether a next page
   * exists.
   */
  async listByProcedure(
    procedureId: string,
    page: number,
    limit: number,
    peek = false,
  ): Promise<RunSummary[]> {
    return await this.table
      .filter((doc) => doc.key("procedureId").eq(procedureId))
      .orderBy("startedAt", "desc")
      .slice(page * limit, peek ? limit + 1 : limit)
      .pluck(...RUN_SUMMARY_FIELDS)
      .run();
  }
}
