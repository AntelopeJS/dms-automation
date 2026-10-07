import { BasicDataModel } from "@antelopejs/interface-database-decorators";
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
  "startedAt",
  "endedAt",
  "status",
  "errorMessage",
  "triggerNodeId",
  "kind",
  "failedNodeId",
  "rerunOf",
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

  /** Write a procedure's current name on all its runs. */
  async renameProcedure(procedureId: string, name: string): Promise<number> {
    return await this.table
      .filter((row) => row.key("procedureId").eq(procedureId))
      .update({ procedureName: name })
      .run();
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
