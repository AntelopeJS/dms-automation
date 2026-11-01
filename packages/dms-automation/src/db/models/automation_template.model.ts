import {
  BasicDataModel,
  GetModel,
} from "@antelopejs/interface-database-decorators";
import { DATABASE_NAME } from "../../types/constants";
import {
  type TemplateCache,
  walkPlacedNodes,
} from "../../runtime/resolveSubgraph";
import {
  type GroupPort,
  isTemplateInstance,
  parseGraph,
  type ProcedureGraph,
  type TemplateInstanceNode,
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
export type TemplateUsage = {
  procedureId: string;
  nodeId: string;
  /** Ids of the local groups the node sits in, outermost first. */
  groupPath: string[];
};

/** A group node placing a template inside another template's graph. */
export type TemplateNesting = {
  /** The template whose graph places it. */
  templateId: string;
  nodeId: string;
  /** Ids of the local groups the node sits in, outermost first. */
  groupPath: string[];
};

/** A template instance of a stored graph, and the local groups around it. */
export interface PlacedInstance {
  node: TemplateInstanceNode;
  groupPath: string[];
}

/** Enters no template: a stored graph only holds references to them. */
const NO_TEMPLATES: TemplateCache = { get: () => undefined };

/**
 * Every template instance of a stored graph, inside nested local groups too.
 * Instances inside an instance are the referenced template's own, not this
 * graph's.
 */
export function* templateInstancesOf(
  graph: ProcedureGraph,
): Iterable<PlacedInstance> {
  for (const { node, groups } of walkPlacedNodes(graph, NO_TEMPLATES)) {
    if (!isTemplateInstance(node)) continue;
    yield {
      node,
      groupPath: groups.map((g) => g.id),
    };
  }
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
      ? parseGraph(row.subgraph)
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

  /** Every template, in no particular order. */
  async listAll(): Promise<AutomationTemplateRow[]> {
    return (await this.getAll()).map(parseRow);
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
    const updateObj = {
      updated_at: new Date(),
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && {
        description: patch.description,
      }),
      ...(patch.icon !== undefined && { icon: patch.icon }),
      ...(patch.ports !== undefined && { ports: JSON.stringify(patch.ports) }),
      ...(patch.subgraph !== undefined && {
        subgraph: JSON.stringify(patch.subgraph),
      }),
    };

    await this.update(id, updateObj);
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
    const out: TemplateUsage[] = [];
    for (const p of await procedureModel.getAll()) {
      let graph: ProcedureGraph;
      try {
        graph = parseGraph(p.graph);
      } catch {
        continue;
      }
      for (const { node, groupPath } of templateInstancesOf(graph)) {
        if (node.templateId === templateId) {
          out.push({ procedureId: p._id, nodeId: node.id, groupPath });
        }
      }
    }
    return out;
  }

  /**
   * The other templates whose graph places `templateId`: deleting it must
   * fork those instances too, or every procedure using them breaks.
   */
  async findNestings(templateId: string): Promise<TemplateNesting[]> {
    const out: TemplateNesting[] = [];
    for (const t of await this.listAll()) {
      for (const { node, groupPath } of templateInstancesOf(t.subgraph)) {
        if (node.templateId === templateId) {
          out.push({ templateId: t._id, nodeId: node.id, groupPath });
        }
      }
    }
    return out;
  }
}
