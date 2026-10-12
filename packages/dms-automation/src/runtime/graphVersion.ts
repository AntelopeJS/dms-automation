import type { GraphNode, ProcedureGraph } from "../types/graph";

// What a node carries for the canvas only: where it sits and how it looks.
// Changing it changes nothing a run does.
const VISUAL_NODE_KEYS = new Set([
  "position",
  "width",
  "height",
  "measured",
  "selected",
  "dragging",
  "zIndex",
  "style",
  "color",
]);

function executableNode(node: GraphNode): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (VISUAL_NODE_KEYS.has(key)) continue;
    kept[key] =
      key === "subgraph" && value
        ? executableGraph(value as ProcedureGraph)
        : value;
  }
  return kept;
}

/** A graph without what only the canvas reads, nested groups included. */
export function executableGraph(graph: ProcedureGraph): unknown {
  return {
    nodes: graph.nodes.map(executableNode),
    triggerEdges: graph.triggerEdges,
    dataEdges: graph.dataEdges,
  };
}

/**
 * Whether saving `next` over the stored graph changes what a run executes:
 * moving or restyling nodes does not, so the version (stamped on runs) stays.
 */
export function changesExecution(
  stored: string,
  next: ProcedureGraph,
): boolean {
  try {
    const before = executableGraph(JSON.parse(stored) as ProcedureGraph);
    return JSON.stringify(before) !== JSON.stringify(executableGraph(next));
  } catch {
    return true;
  }
}
