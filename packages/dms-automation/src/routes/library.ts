import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  type RequestContext,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { GetApiBaseUrl } from "@antelopejs/interface-dms/api-base-url";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { AutomationTemplateModel } from "../db/models/automation_template.model";
import { healthByProcedure, loadStatsContext } from "../db/models/stats.model";
import { labelOf, summarizeTrigger } from "../runtime/describe";
import { nodeKinds } from "../runtime/nodeKinds";
import { registry } from "../runtime/registry";
import { walkPlacedNodes } from "../runtime/resolveSubgraph";
import { DATABASE_NAME } from "../types/constants";
import type { GraphNode } from "../types/graph";

/** The palette categories of the plain node kinds the Flow catalog lists. */
const FLOW_CATEGORIES = new Set(["flow", "helper"]);

function isFlowKind(kind: string): boolean {
  const category = nodeKinds.metaOf(kind)?.ui?.category;
  return !!category && FLOW_CATEGORIES.has(category);
}

/**
 * The entry of each catalog a node places, if any: its type for the
 * registry catalogs, its kind for the Flow one.
 */
const ENTRY_OF_CATALOG = new Map<
  string,
  (node: GraphNode) => string | undefined
>([
  ["triggers", (node) => (node.kind === "trigger" ? node.typeId : undefined)],
  ["actions", (node) => (node.kind === "action" ? node.typeId : undefined)],
  ["dataNodes", (node) => (node.kind === "data" ? node.typeId : undefined)],
  ["flow", (node) => (isFlowKind(node.kind) ? node.kind : undefined)],
]);

/** One node of a procedure using a catalog entry. */
interface TypeUsage {
  procedureId: string;
  procedureName: string;
  enabled: boolean;
  state: string;
  /**
   * The node to open in the builder: the one placing the entry, or the
   * template instance it is reached through.
   */
  nodeId: string;
  nodeLabel: string | null;
  /** Ids of the groups to enter to reach `nodeId`, outermost first. */
  groupPath: string[];
  /** The label of the group `nodeId` sits in, if it has one. */
  groupLabel: string | null;
  /** The template the entry is placed by, when reached through one. */
  viaTemplate: { id: string; name: string } | null;
  method?: string;
  path?: string;
  cron?: string;
  timeZone?: string;
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
      flow: nodeKinds.listAll().filter(({ kind }) => isFlowKind(kind)).length,
    };
  }

  /**
   * The origin webhooks are called on: the DMS `apiBaseUrl`, else the one
   * this request reached the API on — the address the dashboard's server
   * calls it on, right when it is also the public one.
   */
  @Get("/webhook-base")
  async webhookBase(
    @AuthRawUser() _user: User,
    @Context() context: RequestContext,
  ): Promise<{ url: string; configured: boolean }> {
    const configured = (await GetApiBaseUrl())?.trim().replace(/\/+$/, "");
    if (configured) return { url: configured, configured: true };
    return { url: context.url.origin, configured: false };
  }

  /**
   * Where each entry of a catalog is used: every node placing it, in every
   * procedure, inside nested groups and the templates they place too, with
   * the procedure's state. Keyed by type id (node kind for the Flow catalog).
   */
  @Get("/usage/:catalog")
  async usage(
    @AuthRawUser() _user: User,
    @Parameter("catalog", "param") catalog: string,
  ): Promise<Record<string, TypeUsage[]>> {
    const entryOf = ENTRY_OF_CATALOG.get(catalog);
    if (!entryOf) {
      throw new HTTPResult(404, { error: `catalog "${catalog}" not found` });
    }
    const [ctx, templates] = await Promise.all([
      loadStatsContext(),
      GetModel(AutomationTemplateModel, DATABASE_NAME).listAll(),
    ]);
    const templateById = new Map(templates.map((t) => [t._id, t]));
    const health = healthByProcedure(ctx);
    const out: Record<string, TypeUsage[]> = {};
    for (const { procedure, graph } of ctx.procedures) {
      if (!graph) continue;
      for (const { node, groups, viaTemplate } of walkPlacedNodes(
        graph,
        templateById,
      )) {
        const entry = entryOf(node);
        if (!entry) continue;
        const group = groups.at(-1);
        const template = viaTemplate?.templateId
          ? templateById.get(viaTemplate.templateId)
          : undefined;
        const usage: TypeUsage = {
          procedureId: procedure._id,
          procedureName: procedure.name,
          enabled: procedure.enabled,
          state: health.get(procedure._id)?.state ?? "draft",
          nodeId: viaTemplate?.id ?? node.id,
          nodeLabel: labelOf(node) ?? null,
          groupPath: groups.map((g) => g.id),
          groupLabel: group ? (labelOf(group) ?? null) : null,
          viaTemplate: template
            ? { id: template._id, name: template.name }
            : null,
        };
        if (node.kind === "trigger") {
          const { method, path, cron, timeZone } = summarizeTrigger(node);
          Object.assign(usage, { method, path, cron, timeZone });
        }
        (out[entry] ??= []).push(usage);
      }
    }
    return out;
  }
}
