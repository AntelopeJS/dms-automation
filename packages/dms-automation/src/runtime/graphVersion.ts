import type { DataRecord, DataValue } from "../types/dataValue";
import {
  type GraphNode,
  parseGraph,
  type ProcedureGraph,
} from "../types/graph";

/**
 * What a node carries for the canvas only: where it sits and how it looks.
 * Changing it changes nothing a run does.
 */
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

type NodeWithSubgraph = GraphNode & { subgraph?: ProcedureGraph };

function executableNode(node: NodeWithSubgraph): DataRecord {
  const kept: DataRecord = {};
  for (const [key, value] of Object.entries<DataValue>(node)) {
    if (VISUAL_NODE_KEYS.has(key)) continue;
    kept[key] =
      key === "subgraph" && node.subgraph
        ? executableGraph(node.subgraph)
        : value;
  }
  return kept;
}

/** A graph without what only the canvas reads, nested groups included. */
function executableGraph(graph: ProcedureGraph): DataRecord {
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
    const before = executableGraph(parseGraph(stored));
    return JSON.stringify(before) !== JSON.stringify(executableGraph(next));
  } catch {
    return true;
  }
}
