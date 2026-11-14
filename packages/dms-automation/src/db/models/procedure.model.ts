import { BasicDataModel } from "@antelopejs/interface-database-decorators";
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

  /** Every procedure, the most recently updated first. */
  async newestFirst(): Promise<Procedure[]> {
    return await this.table.orderBy("updated_at", "desc").run();
  }
}
