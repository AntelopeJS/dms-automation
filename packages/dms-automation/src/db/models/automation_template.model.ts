import {
  BasicDataModel,
  GetModel,
} from "@antelopejs/interface-database-decorators";
import { DATABASE_NAME, FETCH_ALL_LIMIT } from "../../types/constants";
import {
  type GraphNode,
  type GroupPort,
  type ProcedureGraph,
  walkNodesRecursive,
} from "../../types/graph";
import type { PageParams, Paginated } from "../../types/pagination";
import {
  AutomationTemplate,
  automationTemplatesTableName,
} from "../tables/automation_template.table";
import { ProcedureModel } from "./procedure.model";

/**
 * Hydrated template row — `ports` and `subgraph` are parsed from the raw JSON
 * strings stored on the table. Everything else mirrors the table shape.
 */
export interface AutomationTemplateRow {
  _id: string;
  name: string;
  description: string;
  icon: string;
  ports: GroupPort[];
  subgraph: ProcedureGraph;
  created_at: Date;
  updated_at: Date;
}

/** A single group-node usage of a template, located by a procedure scan. */
export interface TemplateUsage {
  procedureId: string;
  nodeId: string;
}

/** Fields accepted when creating a template. */
export interface CreateTemplateInput {
  name: string;
  description?: string;
  icon?: string;
  ports: GroupPort[];
  subgraph: ProcedureGraph;
}

/** Patch accepted when updating a template (any subset of the mutable fields). */
export type UpdateTemplatePatch = Partial<{
  name: string;
  description: string;
  icon: string;
  ports: GroupPort[];
  subgraph: ProcedureGraph;
}>;

function parseRow(row: AutomationTemplate): AutomationTemplateRow {
  let ports: GroupPort[] = [];
  let subgraph: ProcedureGraph = {
    nodes: [],
    triggerEdges: [],
    dataEdges: [],
  };
  try {
    ports = row.ports ? (JSON.parse(row.ports) as GroupPort[]) : [];
  } catch {
    ports = [];
  }
  try {
    subgraph = row.subgraph
      ? (JSON.parse(row.subgraph) as ProcedureGraph)
      : { nodes: [], triggerEdges: [], dataEdges: [] };
  } catch {
    subgraph = { nodes: [], triggerEdges: [], dataEdges: [] };
  }
  return {
    _id: row._id,
    name: row.name,
    description: row.description ?? "",
    icon: row.icon ?? "",
    ports,
    subgraph,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class AutomationTemplateModel extends BasicDataModel(
  AutomationTemplate,
  automationTemplatesTableName,
) {
  async list(options: PageParams): Promise<Paginated<AutomationTemplateRow>> {
    const totalReq = this.table.count();
    const finalReq = this.table
      .orderBy("updated_at", "desc")
      .slice(options.page * options.limit, options.limit);

    const [total, rows] = await Promise.all([totalReq.run(), finalReq.run()]);

    return {
      results: rows.map(parseRow),
      total,
      page: options.page,
      limit: options.limit,
    };
  }

  async getById(id: string): Promise<AutomationTemplateRow | undefined> {
    const row = await this.get(id);
    if (!row) return undefined;
    return parseRow(row);
  }

  async create(input: CreateTemplateInput): Promise<AutomationTemplateRow> {
    const now = new Date();
    const ids = await this.insert({
      name: input.name,
      description: input.description ?? "",
      icon: input.icon ?? "",
      ports: JSON.stringify(input.ports),
      subgraph: JSON.stringify(input.subgraph),
      created_at: now,
      updated_at: now,
    });
    const id = ids[0];
    if (!id) {
      throw new Error("automation_template insert returned no id");
    }
    const created = await this.get(id);
    if (!created) {
      throw new Error(`automation_template ${id} not found after insert`);
    }
    return parseRow(created);
  }

  async updateById(
    id: string,
    patch: UpdateTemplatePatch,
  ): Promise<AutomationTemplateRow> {
    const updateObj: Record<string, unknown> = {
      updated_at: new Date(),
    };
    if (patch.name !== undefined) updateObj.name = patch.name;
    if (patch.description !== undefined)
      updateObj.description = patch.description;
    if (patch.icon !== undefined) updateObj.icon = patch.icon;
    if (patch.ports !== undefined)
      updateObj.ports = JSON.stringify(patch.ports);
    if (patch.subgraph !== undefined)
      updateObj.subgraph = JSON.stringify(patch.subgraph);

    await this.update(id, updateObj as never);
    const updated = await this.get(id);
    if (!updated) {
      throw new Error(`automation_template ${id} not found after update`);
    }
    return parseRow(updated);
  }

  async deleteById(id: string): Promise<void> {
    await this.delete(id);
  }

  /**
   * Scan every procedure and locate group nodes whose `templateId` matches.
   * Walks subgraphs recursively so a template instance nested inside a local
   * group is still discovered as a usage.
   */
  async findUsages(templateId: string): Promise<TemplateUsage[]> {
    const procedureModel = GetModel(ProcedureModel, DATABASE_NAME);
    const procs = await procedureModel.list({
      page: 0,
      limit: FETCH_ALL_LIMIT,
    });
    const out: TemplateUsage[] = [];
    for (const p of procs.results) {
      let graph: ProcedureGraph;
      try {
        graph = JSON.parse(p.graph) as ProcedureGraph;
      } catch {
        continue;
      }
      for (const node of walkNodesRecursive(graph)) {
        if (node.kind !== "group") continue;
        const groupNode = node as GraphNode & { templateId?: string };
        if (groupNode.templateId === templateId) {
          out.push({ procedureId: p._id, nodeId: node.id });
        }
      }
    }
    return out;
  }
}
