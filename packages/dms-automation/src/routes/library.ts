import { Controller, Get, Parameter } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { AutomationTemplateModel } from "../db/models/automation_template.model";
import { healthByProcedure, loadStatsContext } from "../db/models/stats.model";
import { labelOf, summarizeTrigger } from "../runtime/describe";
import { registry } from "../runtime/registry";
import { DATABASE_NAME } from "../types/constants";
import { walkNodesRecursive } from "../types/graph";

/** The node kind each catalog's types are placed with. */
const KIND_OF_CATALOG: Record<string, string> = {
  triggers: "trigger",
  actions: "action",
  dataNodes: "data",
};

/** One node of a procedure using a catalog type. */
interface TypeUsage {
  procedureId: string;
  procedureName: string;
  enabled: boolean;
  state: string;
  nodeId: string;
  nodeLabel: string | null;
  method?: string;
  path?: string;
  cron?: string;
}

@AuthOwnerOnly()
export class LibraryController extends Controller("/api/automation/library") {
  /** The counts on the library's tabs. */
  @Get("/counts")
  async counts(@AuthRawUser() _user: User) {
    const templates = await GetModel(AutomationTemplateModel, DATABASE_NAME)
      .table.count()
      .run();
    return {
      triggers: registry.listTriggers().length,
      actions: registry.listActions().length,
      dataNodes: registry.listDataNodes().length,
      templates,
    };
  }

  /**
   * Where each type of a catalog is used: every node placing it, in every
   * procedure, nested groups included, with the procedure's state. Keyed by
   * type id.
   */
  @Get("/usage/:catalog")
  async usage(
    @AuthRawUser() _user: User,
    @Parameter("catalog", "param") catalog: string,
  ): Promise<Record<string, TypeUsage[]>> {
    const kind = KIND_OF_CATALOG[catalog];
    if (!kind) return {};
    const ctx = await loadStatsContext();
    const health = healthByProcedure(ctx);
    const out: Record<string, TypeUsage[]> = {};
    for (const { procedure, graph } of ctx.procedures) {
      if (!graph) continue;
      for (const node of walkNodesRecursive(graph)) {
        if (node.kind !== kind || !node.typeId) continue;
        const usage: TypeUsage = {
          procedureId: procedure._id,
          procedureName: procedure.name,
          enabled: procedure.enabled,
          state: health.get(procedure._id)?.state ?? "draft",
          nodeId: node.id,
          nodeLabel: labelOf(node) ?? null,
        };
        if (kind === "trigger") {
          const { method, path, cron } = summarizeTrigger(node);
          Object.assign(usage, { method, path, cron });
        }
        (out[node.typeId] ??= []).push(usage);
      }
    }
    return out;
  }
}
