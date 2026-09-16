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
