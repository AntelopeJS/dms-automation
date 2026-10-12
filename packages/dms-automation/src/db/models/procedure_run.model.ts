import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { clearCredentialPattern } from "../../runtime/boundRunLog";
import {
  ProcedureRun,
  procedureRunsTableName,
} from "../tables/procedure_run.table";

/** One page of the run list. */
export interface RunListQuery {
  page: number;
  limit: number;
  procedureId?: string;
  status?: string;
  since?: Date;
  /**
   * Over-fetch one extra row as a "has next page" probe. The offset stays
   * page*limit, so paging never overlaps or gaps; the caller trims the surplus
   * row and uses its presence to decide whether a next page exists.
   */
  peek?: boolean;
}

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
 * its production runs (`kind` absent, `run` or `rerun`), in a time range, of
 * one status when given.
 */
export interface HistoryQuery {
  tests: boolean;
  /** Started strictly after. */
  after?: Date;
  /** Started strictly before. */
  before?: Date;
  status?: string;
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

/** What the boot back-fill reads of a run stored before kinds existed. */
export type LegacyRun = Pick<
  ProcedureRun,
  | "_id"
  | "procedureId"
  | "startedAt"
  | "endedAt"
  | "durationMs"
  | "triggerNodeId"
  | "triggerSummary"
>;

const LEGACY_RUN_FIELDS = [
  "_id",
  "procedureId",
  "startedAt",
  "endedAt",
  "durationMs",
  "triggerNodeId",
  "triggerSummary",
] as const;

export class ProcedureRunModel extends BasicDataModel(
  ProcedureRun,
  procedureRunsTableName,
) {
  /**
   * Reads the complete window without payloads or execution logs, test runs
   * included: callers keep the production runs (`isProductionRun`).
   */
  async listForStats(since: Date): Promise<StatsRun[]> {
    return this.table
      .filter((row) => row.key("startedAt").ge(since))
      .orderBy("startedAt", "desc")
      .pluck(...STATS_FIELDS)
      .run() as Promise<StatsRun[]>;
  }

  /** The newest runs of one procedure, any kind, without payloads or logs. */
  async latestOfProcedure(
    procedureId: string,
    limit: number,
  ): Promise<RunSummary[]> {
    return this.listByProcedure(procedureId, 0, limit);
  }

  /** Write a procedure's current name on those of its runs that lack it. */
  async renameProcedure(procedureId: string, name: string): Promise<number> {
    return await this.table
      .filter((row) =>
        row
          .key("procedureId")
          .eq(procedureId)
          .and(row.key("procedureName").default("").ne(name)),
      )
      .update({ procedureName: name })
      .run();
  }

  /**
   * Write a procedure's current version on its production runs of an older
   * one that lack it, so the run list tells them apart. Called when the
   * procedure is saved, and at boot.
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
    const [run] = (await this.history(procedureId, query)
      .orderBy("startedAt", "desc")
      .slice(0, 1)
      .pluck(...RUN_SUMMARY_FIELDS)
      .run()) as RunSummary[];
    return run;
  }

  /** The oldest run of a procedure the query matches: the next run. */
  async oldest(
    procedureId: string,
    query: HistoryQuery,
  ): Promise<RunSummary | undefined> {
    const [run] = (await this.history(procedureId, query)
      .orderBy("startedAt", "asc")
      .slice(0, 1)
      .pluck(...RUN_SUMMARY_FIELDS)
      .run()) as RunSummary[];
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
    return (await this.history(procedureId, { ...query, status: "ok" })
      .orderBy("startedAt", "desc")
      .slice(0, limit)
      .pluck(...RUN_TIMING_FIELDS)
      .run()) as RunTiming[];
  }

  private history(
    procedureId: string,
    { tests, after, before, status }: HistoryQuery,
  ) {
    let query = this.table.filter((row) =>
      row
        .key("procedureId")
        .eq(procedureId)
        .and(
          tests
            ? row.key("kind").eq("test")
            : row.key("kind").default("run").ne("test"),
        ),
    );
    if (after) query = query.filter((row) => row.key("startedAt").gt(after));
    if (before) query = query.filter((row) => row.key("startedAt").lt(before));
    if (status) query = query.filter((row) => row.key("status").eq(status));
    return query;
  }

  /**
   * Runs stored before runs kept their kind, duration and trigger (no
   * `kind`): the boot back-fill completes them once.
   */
  async listLegacy(): Promise<LegacyRun[]> {
    return (await this.table
      .filter((row) => row.key("kind").default("").eq(""))
      .pluck(...LEGACY_RUN_FIELDS)
      .run()) as LegacyRun[];
  }

  /**
   * Runs whose stored webhook payload still holds a credential in clear
   * (stored before headers and query parameters were redacted).
   */
  async listWithClearCredentials(): Promise<Pick<ProcedureRun, "_id">[]> {
    return (await this.table
      .filter((row) =>
        row.key("triggerPayload").default("").match(clearCredentialPattern()),
      )
      .pluck("_id")
      .run()) as Pick<ProcedureRun, "_id">[];
  }

  /** Delete the runs started before `before`; returns how many went. */
  async purgeBefore(before: Date): Promise<number> {
    return await this.table
      .filter((row) => row.key("startedAt").lt(before))
      .delete()
      .run();
  }

  async listByProcedure(
    procedureId: string,
    page: number,
    limit: number,
    // Over-fetch one extra row as a "has next page" probe, mirroring listAll.
    // The caller trims the surplus row and uses its presence to decide whether
    // a next page exists.
    peek = false,
  ): Promise<RunSummary[]> {
    return (await this.table
      .filter((doc) => doc.key("procedureId").eq(procedureId))
      .orderBy("startedAt", "desc")
      .slice(page * limit, peek ? limit + 1 : limit)
      .pluck(...RUN_SUMMARY_FIELDS)
      .run()) as RunSummary[];
  }

  async listAll({
    page,
    limit,
    procedureId,
    status,
    since,
    peek = false,
  }: RunListQuery): Promise<RunSummary[]> {
    let base = this.table;
    if (procedureId) {
      base = base.filter((doc) => doc.key("procedureId").eq(procedureId));
    }
    if (status) {
      base = base.filter((doc) => doc.key("status").eq(status));
    }
    if (since) {
      base = base.filter((doc) => doc.key("startedAt").ge(since));
    }
    return (await base
      .orderBy("startedAt", "desc")
      .slice(page * limit, peek ? limit + 1 : limit)
      .pluck(...RUN_SUMMARY_FIELDS)
      .run()) as RunSummary[];
  }
}
