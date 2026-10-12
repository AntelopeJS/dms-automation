import {
  type GraphNode,
  type GroupNode,
  isGroupNode,
  type ProcedureGraph,
  walkNodesRecursive,
} from "../types/graph";

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

/** A node met by `walkPlacedNodes`, and where it sits in the walked graph. */
export interface PlacedNode {
  node: GraphNode;
  /**
   * The local groups entered to reach it, outermost first. Inside a template
   * instance, the groups leading to that instance: the walked graph stores
   * nothing deeper.
   */
  groups: GroupNode[];
  /** The outermost template instance the node sits in, if any. */
  viaTemplate?: GroupNode;
}

/**
 * Depth-first walk of every node of a graph, entering local groups like
 * `walkNodesRecursive` and, unlike it, template instances too, through
 * `templateCache`. A missing template, or one already entered on the way
 * (a reference cycle), is not entered.
 */
export function* walkPlacedNodes(
  graph: ProcedureGraph,
  templateCache: TemplateCache,
): Iterable<PlacedNode> {
  yield* walkPlaced(graph, templateCache, [], undefined, new Set());
}

function* walkPlaced(
  graph: ProcedureGraph,
  templateCache: TemplateCache,
  groups: GroupNode[],
  viaTemplate: GroupNode | undefined,
  enteredTemplates: ReadonlySet<string>,
): Iterable<PlacedNode> {
  for (const node of graph.nodes ?? []) {
    yield { node, groups, viaTemplate };
    if (!isGroupNode(node)) continue;
    if (node.templateId) {
      const template = templateCache.get(node.templateId);
      if (!template || enteredTemplates.has(node.templateId)) continue;
      yield* walkPlaced(
        template.subgraph,
        templateCache,
        groups,
        viaTemplate ?? node,
        new Set([...enteredTemplates, node.templateId]),
      );
    } else if (node.subgraph) {
      yield* walkPlaced(
        node.subgraph,
        templateCache,
        viaTemplate ? groups : [...groups, node],
        viaTemplate,
        enteredTemplates,
      );
    }
  }
}

/**
 * Turn every instance of `template` in `graph`, nested local groups included,
 * into a local group holding its own copy of the template's subgraph, so the
 * graph no longer depends on it. A group without a label of its own keeps the
 * template's name, as the builder showed it. Mutates `graph`; returns how
 * many instances it turned.
 */
export function forkTemplateInstances(
  graph: ProcedureGraph,
  template: { _id: string; name: string; subgraph: ProcedureGraph },
): number {
  let forked = 0;
  for (const node of walkNodesRecursive(graph)) {
    if (!isGroupNode(node) || node.templateId !== template._id) continue;
    const group = node as GroupNode & { label?: string };
    delete group.templateId;
    group.subgraph = structuredClone(template.subgraph);
    if (!group.label?.trim()) group.label = template.name;
    forked++;
  }
  return forked;
}
