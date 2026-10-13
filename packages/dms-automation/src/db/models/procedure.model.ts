import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import type { PageParams, Paginated } from "../../types/pagination";
import { Procedure, proceduresTableName } from "../tables/procedure.table";

export class ProcedureModel extends BasicDataModel(
  Procedure,
  proceduresTableName,
) {
  async listEnabled(): Promise<Procedure[]> {
    return await this.table.filter((doc) => doc.key("enabled").eq(true)).run();
  }

  /**
   * Apply `patch` only while the procedure is still at `revision`: of two
   * saves made on the same revision, the second finds it moved on. Returns
   * whether the patch was applied.
   */
  async updateAtRevision(
    id: string,
    revision: number,
    patch: Partial<Procedure>,
  ): Promise<boolean> {
    const updated = await this.table
      .filter((doc) =>
        doc.key("_id").eq(id).and(doc.key("revision").eq(revision)),
      )
      .update(patch)
      .run();
    return updated > 0;
  }

  async list(options: PageParams): Promise<Paginated<Procedure>> {
    const totalReq = this.table.count();
    const finalReq = this.table
      .orderBy("updated_at", "desc")
      .slice(options.page * options.limit, options.limit);

    const [total, results] = await Promise.all([
      totalReq.run(),
      finalReq.run(),
    ]);

    return {
      results,
      total,
      page: options.page,
      limit: options.limit,
    };
  }
}
