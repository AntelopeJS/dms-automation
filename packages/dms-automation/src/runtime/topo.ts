import type { ProcedureGraph } from "../types/graph";

/**
 * Returns the node IDs strictly downstream of `(sourceNodeId, sourcePort?)`
 * along trigger edges, in topological order. The source node itself is
 * NOT included.
 *
 * When `sourcePort` is provided, only outgoing edges from the source whose
 * `edge.from.branch === sourcePort` are followed off the seed. Once past
 * the seed's immediate neighbours, every outgoing edge is followed (branch
 * filtering inside the sub-walk is handled by `SubWalk.hasLiveIncoming`).
 *
 * When `sourcePort` is undefined, all outgoing edges from the source are
 * followed — this is the bootstrap-trigger case where the entry node has
 * no port discrimination.
 *
 * Throws when a cycle is detected within the reachable subgraph.
 */
export function topoFromPort(
  graph: ProcedureGraph,
  sourceNodeId: string,
  sourcePort: string | undefined,
): string[] {
  const reachable = new Set<string>();
  const queue: string[] = [];

  // Seed-port filter: only enqueue immediate downstreams of the seed that
  // leave through the matching port (or any, if sourcePort is undefined).
  for (const e of graph.triggerEdges) {
    if (e.from.node !== sourceNodeId) continue;
    if (sourcePort !== undefined && e.from.branch !== sourcePort) continue;
    if (!reachable.has(e.to.node)) {
      reachable.add(e.to.node);
      queue.push(e.to.node);
    }
  }

  // BFS the rest with no port filter — liveness inside the sub-walk is
  // enforced by branch decisions, not by edge filtering at topo time.
  const adj = adjacency(graph);
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const next of adj.get(cur) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  const order = kahn(graph, reachable);
  if (order === null) {
    throw new Error("Cycle detected in trigger edges");
  }
  return order;
}

function adjacency(graph: ProcedureGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of graph.triggerEdges) {
    const list = adj.get(e.from.node);
    if (list) list.push(e.to.node);
    else adj.set(e.from.node, [e.to.node]);
  }
  return adj;
}

/**
 * Kahn's algorithm over the subgraph of trigger edges induced by `nodes`.
 * Returns the topological order, or `null` when that subgraph contains a
 * cycle (i.e. fewer nodes get emitted than are in the set). Shared by
 * `topoFromPort` (which throws on `null`) and the graph validator (which
 * records a validation error).
 */
export function kahn(
  graph: ProcedureGraph,
  nodes: Set<string>,
): string[] | null {
  const inDegree = new Map<string, number>();
  for (const id of nodes) inDegree.set(id, 0);
  for (const e of graph.triggerEdges) {
    if (nodes.has(e.from.node) && nodes.has(e.to.node)) {
      inDegree.set(e.to.node, (inDegree.get(e.to.node) ?? 0) + 1);
    }
  }

  const adj = adjacency(graph);
  const ready: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) ready.push(id);
  }

  const result: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift() as string;
    result.push(id);
    for (const next of adj.get(id) ?? []) {
      if (!nodes.has(next)) continue;
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }

  return result.length === nodes.size ? result : null;
}
