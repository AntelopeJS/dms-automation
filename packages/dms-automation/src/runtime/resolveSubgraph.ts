import type { GroupNode, ProcedureGraph } from "../types/graph";

export interface TemplateCache {
  get(id: string): { subgraph: ProcedureGraph } | undefined;
}

export function resolveSubgraph(
  node: GroupNode,
  templateCache: TemplateCache,
): ProcedureGraph {
  if (node.templateId) {
    const t = templateCache.get(node.templateId);
    if (!t) throw new Error(`template ${node.templateId} not found`);
    return t.subgraph;
  }
  if (!node.subgraph)
    throw new Error(`local group ${node.id} missing subgraph`);
  return node.subgraph;
}
