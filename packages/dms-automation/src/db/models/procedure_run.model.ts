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
  "_id" | "procedureId" | "startedAt" | "endedAt" | "status" | "errorMessage"
>;

export class ProcedureRunModel extends BasicDataModel(
  ProcedureRun,
  procedureRunsTableName,
) {
  /** Reads the complete window without payloads or execution logs. */
  async listForStats(since: Date): Promise<StatsRun[]> {
    return this.table
      .filter((row) => row.key("startedAt").ge(since))
      .orderBy("startedAt", "desc")
      .pluck(
        "_id",
        "procedureId",
        "startedAt",
        "endedAt",
        "status",
        "errorMessage",
      )
      .run() as Promise<StatsRun[]>;
  }

  async listByProcedure(
    procedureId: string,
    page: number,
    limit: number,
    // Over-fetch one extra row as a "has next page" probe, mirroring listAll.
    // The caller trims the surplus row and uses its presence to decide whether
    // a next page exists.
    peek = false,
  ): Promise<ProcedureRun[]> {
    return await this.table
      .filter((doc) => doc.key("procedureId").eq(procedureId))
      .orderBy("startedAt", "desc")
      .slice(page * limit, peek ? limit + 1 : limit)
      .run();
  }

  async listAll({
    page,
    limit,
    procedureId,
    status,
    since,
    peek = false,
  }: RunListQuery): Promise<ProcedureRun[]> {
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
    return await base
      .orderBy("startedAt", "desc")
      .slice(page * limit, peek ? limit + 1 : limit)
      .run();
  }
}
