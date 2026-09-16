import type { JsonSchema } from "@antelopejs/interface-dms-automation";

/**
 * Node kind is a free-form string keyed off the runtime kind registry.
 * The canonical list lives in `runtime/builtins/nodes/` — one file per
 * kind, each registering itself at module load. Validation against the
 * live registry happens via `nodeKindZodSchema()` in HTTP routes.
 *
 * Special cases:
 *  - `"group"` is owned by `runtime/flatten.ts` and is not in the kind
 *    registry; it's accepted by the Zod schema as an explicit literal.
 *  - `"groupInput"` / `"groupOutput"` are sentinels only valid INSIDE a
 *    group's subgraph; they are registered like any other kind but the
 *    editor manages them automatically.
 */
export interface GraphNode {
  id: string;
  kind: string;
  typeId?: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

/** One end of a trigger edge. `branch` is absent when the end has none. */
export interface TriggerEdgeEnd {
  node: string;
  branch?: string;
}

/** Builds an end, setting `branch` only when there is one. */
export function triggerEdgeEnd(
  node: string,
  branch: string | undefined,
): TriggerEdgeEnd {
  const end: TriggerEdgeEnd = { node };
  if (branch !== undefined) end.branch = branch;
  return end;
}

export interface TriggerEdge {
  id: string;
  from: TriggerEdgeEnd;
  // `branch` on the target carries the name of the target's trigger-in port
  // when the target is a group node or a groupOutput sentinel. It is absent
  // for ordinary target nodes, whose trigger-in is a single fixed handle.
  to: TriggerEdgeEnd;
}

export interface DataEdge {
  id: string;
  from: { node: string; port: string };
  to: { node: string; field: string };
}

export interface ProcedureGraph {
  nodes: GraphNode[];
  triggerEdges: TriggerEdge[];
  dataEdges: DataEdge[];
}

export interface GroupPort {
  name: string;
  kind: "data" | "trigger";
  direction: "in" | "out";
  schema?: JsonSchema; // present iff kind === "data"
}

export interface GroupNode extends GraphNode {
  kind: "group";
  templateId?: string; // present iff this is a template instance
  ports: GroupPort[];
  subgraph?: ProcedureGraph; // present iff local (no templateId)
}

export function isGroupNode(n: GraphNode): n is GroupNode {
  return n.kind === "group";
}

/**
 * Depth-first walk of every node in a graph, recursing into any local subgraph
 * attached to a `group` node. Template-instance group nodes (no inline
 * `subgraph`) are not recursed into — their subgraph is owned by the referenced
 * template, not this graph.
 */
export function* walkNodesRecursive(
  graph: ProcedureGraph,
): Iterable<GraphNode> {
  for (const node of graph.nodes ?? []) {
    yield node;
    if (isGroupNode(node) && node.subgraph) {
      yield* walkNodesRecursive(node.subgraph);
    }
  }
}
