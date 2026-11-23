import type {
  GraphNode,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import { newId } from "../../../utils/automation";
import { cloneGraph } from "../../utils/editor/graphShape";

export const NEXT_STEP_OFFSET = { x: 40, y: 60 };

interface EdgeEnds {
  id: string;
  from: { node: string };
  to: { node: string };
}

/** Group boundaries belong to their group: they are not copied, nor duplicated. */
export function isGroupBoundary(node: GraphNode): boolean {
  return node.kind === "groupInput" || node.kind === "groupOutput";
}

/** The chosen steps and the wires between them, or null when none can be copied. */
export function copiedGraph(
  g: ProcedureGraph,
  chosen: ReadonlySet<string>,
): ProcedureGraph | null {
  const nodes = g.nodes.filter((n) => chosen.has(n.id) && !isGroupBoundary(n));
  if (nodes.length === 0) return null;
  const kept = new Set(nodes.map((n) => n.id));
  const betweenKept = (e: EdgeEnds) =>
    kept.has(e.from.node) && kept.has(e.to.node);
  return cloneGraph({
    nodes,
    triggerEdges: g.triggerEdges.filter(betweenKept),
    dataEdges: g.dataEdges.filter(betweenKept),
  });
}

/** Each paste lands one step further than the last, like Duplicate. */
export function shiftedNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.map((n) => ({
    ...n,
    position: {
      x: n.position.x + NEXT_STEP_OFFSET.x,
      y: n.position.y + NEXT_STEP_OFFSET.y,
    },
  }));
}

function renewedEdges<E extends EdgeEnds>(
  edges: E[],
  ids: ReadonlyMap<string, string>,
): E[] {
  return edges.flatMap((e) => {
    const from = ids.get(e.from.node);
    const to = ids.get(e.to.node);
    if (from === undefined || to === undefined) return [];
    return [
      {
        ...e,
        id: newId(),
        from: { ...e.from, node: from },
        to: { ...e.to, node: to },
      },
    ];
  });
}

/**
 * The graph with the copy added under new ids, and the id of the step pasted last; null when nothing is left to paste. Triggers only live at the top level of a procedure, so they are left out where `triggersAllowed` is false.
 */
export function pastedInto(
  g: ProcedureGraph,
  copy: ProcedureGraph,
  triggersAllowed: boolean,
): { graph: ProcedureGraph; lastId: string } | null {
  const source = cloneGraph(copy);
  const nodes = source.nodes.filter(
    (n) => triggersAllowed || n.kind !== "trigger",
  );
  const ids = new Map(nodes.map((n) => [n.id, newId()]));
  const pasted = nodes.flatMap((n) => {
    const id = ids.get(n.id);
    return id === undefined ? [] : [{ ...n, id }];
  });
  const last = pasted.at(-1);
  if (!last) return null;
  return {
    graph: {
      ...g,
      nodes: [...g.nodes, ...pasted],
      triggerEdges: [
        ...g.triggerEdges,
        ...renewedEdges(source.triggerEdges, ids),
      ],
      dataEdges: [...g.dataEdges, ...renewedEdges(source.dataEdges, ids)],
    },
    lastId: last.id,
  };
}
