import type {
  GraphNode,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";

export function cloneGraph(g: ProcedureGraph): ProcedureGraph {
  return JSON.parse(JSON.stringify(g));
}

// Strip per-node position: a drag is told apart from a structural change.
export function structuralKey(g: ProcedureGraph): string {
  return JSON.stringify({
    nodes: g.nodes.map(({ position: _pos, ...rest }) => rest),
    triggerEdges: g.triggerEdges,
    dataEdges: g.dataEdges,
  });
}

/**
 * What a change does, when it is one a burst of changes repeats: the same
 * nodes moved ("move:a,b"), or the same settings of one node edited
 * ("edit:a:url"), at any depth of groups. `null` for anything else.
 */
export function repeatableChangeKey(
  before: ProcedureGraph,
  after: ProcedureGraph,
): string | null {
  if (
    JSON.stringify([before.triggerEdges, before.dataEdges]) !==
    JSON.stringify([after.triggerEdges, after.dataEdges])
  )
    return null;
  if (before.nodes.length !== after.nodes.length) return null;
  const moved: string[] = [];
  let edited: string | null = null;
  for (let i = 0; i < after.nodes.length; i++) {
    const a = before.nodes[i]! as GraphNode & Record<string, unknown>;
    const b = after.nodes[i]! as GraphNode & Record<string, unknown>;
    if (a.id !== b.id) return null;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
      (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
    );
    if (keys.length === 0) continue;
    if (keys.length === 1 && keys[0] === "position") {
      moved.push(a.id);
      continue;
    }
    if (edited) return null;
    if (
      keys.length === 1 &&
      keys[0] === "subgraph" &&
      a.subgraph &&
      b.subgraph
    ) {
      const inner = repeatableChangeKey(a.subgraph, b.subgraph);
      if (!inner) return null;
      edited = `${a.id}/${inner}`;
      continue;
    }
    if (!keys.every((k) => k === "config" || k === "label")) return null;
    const fields = Object.keys({ ...a.config, ...b.config }).filter(
      (k) => JSON.stringify(a.config?.[k]) !== JSON.stringify(b.config?.[k]),
    );
    edited = `${a.id}:${[...fields, ...(keys.includes("label") ? ["label"] : [])].join(",")}`;
  }
  if (edited) return moved.length ? null : `edit:${edited}`;
  return moved.length ? `move:${moved.join(",")}` : null;
}
