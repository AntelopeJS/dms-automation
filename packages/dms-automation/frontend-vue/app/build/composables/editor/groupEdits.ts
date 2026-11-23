import type {
  GraphNode,
  GroupPort,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import { newId } from "../../../utils/automation";
import { cloneGraph } from "../../utils/editor/graphShape";
import {
  applyPortRenamesToEdges,
  type PortRename,
  syncSentinels,
} from "../../utils/editor/groupPorts";
import type { NewGroupPlan } from "../../utils/editor/groupPlan";
import { NEXT_STEP_OFFSET } from "./graphClipboard";

const SUBGRAPH_LEFT_MARGIN = 220;
const SUBGRAPH_RIGHT_MARGIN = 220;
const RETRY_MAX_ATTEMPTS = 3;

/** Deep copies of the nodes, so a copy never aliases the state it came from. */
function cloneNodes(nodes: GraphNode[]): GraphNode[] {
  return cloneGraph({ nodes, triggerEdges: [], dataEdges: [] }).nodes;
}

/**
 * Group-level "in" ports surface as groupInput's OUT handles, and group-level "out" ports as groupOutput's IN handles: the renames are applied to the edges of the matching sentinel, with the direction inverted.
 */
export function renameSentinelEdges(
  subgraph: ProcedureGraph,
  renames: PortRename[],
): void {
  const input = subgraph.nodes.find((n) => n.kind === "groupInput");
  const output = subgraph.nodes.find((n) => n.kind === "groupOutput");
  const inRenames = renames.filter((r) => r.direction === "in");
  const outRenames = renames.filter((r) => r.direction === "out");
  if (input && inRenames.length > 0)
    applyPortRenamesToEdges(
      subgraph.triggerEdges,
      subgraph.dataEdges,
      input.id,
      inRenames,
      true,
    );
  if (output && outRenames.length > 0)
    applyPortRenamesToEdges(
      subgraph.triggerEdges,
      subgraph.dataEdges,
      output.id,
      outRenames,
      true,
    );
}

/**
 * The group with its ports replaced, as a fresh node whose subgraph can be mutated freely. The renames reach the inner edges before the sentinels are synced: afterwards, the old port names still on the inner edges would read as references to deleted ports and be dropped.
 */
export function groupWithPorts(
  existing: GraphNode,
  ports: GroupPort[],
  renames: PortRename[],
): GraphNode {
  const group: GraphNode = {
    ...existing,
    ports: ports.map((p) => ({ ...p })),
    subgraph: existing.subgraph ? cloneGraph(existing.subgraph) : undefined,
  };
  if (renames.length > 0 && group.subgraph)
    renameSentinelEdges(group.subgraph, renames);
  syncSentinels(group);
  return group;
}

/** The graph with the group node replaced and the renames applied to the edges that end at it. */
export function graphWithRenamedGroupPorts(
  g: ProcedureGraph,
  group: GraphNode,
  renames: PortRename[],
): ProcedureGraph {
  const next: ProcedureGraph = {
    ...g,
    nodes: g.nodes.map((n) => (n.id === group.id ? group : n)),
    triggerEdges: g.triggerEdges.map((e) => ({
      ...e,
      from: { ...e.from },
      to: { ...e.to },
    })),
    dataEdges: g.dataEdges.map((e) => ({
      ...e,
      from: { ...e.from },
      to: { ...e.to },
    })),
  };
  applyPortRenamesToEdges(
    next.triggerEdges,
    next.dataEdges,
    group.id,
    renames,
    false,
  );
  return next;
}

/** Whether none of the selected nodes is a kind that cannot live inside a group's subgraph: triggers live at the top level of a procedure, and the sentinels only inside their own group. */
export function canGroupNodes(
  g: ProcedureGraph,
  selection: ReadonlySet<string>,
): boolean {
  return g.nodes.every(
    (n) =>
      !selection.has(n.id) ||
      !(
        n.kind === "trigger" ||
        n.kind === "groupInput" ||
        n.kind === "groupOutput"
      ),
  );
}

function boundsOf(nodes: GraphNode[]) {
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  return {
    minX,
    minY,
    width: Math.max(maxX - minX, 0),
    height: Math.max(maxY - minY, 0),
    centerX: xs.length ? (minX + maxX) / 2 : 200,
    centerY: ys.length ? (minY + maxY) / 2 : 200,
  };
}

/** The graph with the selection moved into a new group, placed at the selection's centroid. The selected nodes move into the subgraph's coordinate space, left of which the groupInput sentinel sits at x = 0. The edges fully inside the selection are kept verbatim: their ids only need to be unique within the graph that holds them. */
export function graphWithNewGroup(
  g: ProcedureGraph,
  selection: ReadonlySet<string>,
  name: string,
  plan: NewGroupPlan,
): ProcedureGraph {
  const selectedNodes = g.nodes.filter((n) => selection.has(n.id));
  const { minX, minY, width, height, centerX, centerY } =
    boundsOf(selectedNodes);
  const innerNodes = cloneNodes(selectedNodes).map((n) => ({
    ...n,
    position: {
      x: n.position.x - minX + SUBGRAPH_LEFT_MARGIN,
      y: n.position.y - minY,
    },
  }));
  const groupInputNode: GraphNode = {
    id: plan.groupInputId,
    kind: "groupInput",
    config: {},
    position: { x: 0, y: height / 2 },
  };
  const groupOutputNode: GraphNode = {
    id: plan.groupOutputId,
    kind: "groupOutput",
    config: {},
    position: {
      x: width + SUBGRAPH_LEFT_MARGIN + SUBGRAPH_RIGHT_MARGIN,
      y: height / 2,
    },
  };
  const insideSelection = (e: {
    from: { node: string };
    to: { node: string };
  }) => selection.has(e.from.node) && selection.has(e.to.node);
  const touchesSelection = (e: {
    from: { node: string };
    to: { node: string };
  }) => selection.has(e.from.node) || selection.has(e.to.node);
  const newGroupNode: GraphNode = {
    id: plan.groupId,
    kind: "group",
    config: { name },
    position: { x: centerX, y: centerY },
    ports: plan.groupPorts,
    subgraph: {
      nodes: [...innerNodes, groupInputNode, groupOutputNode],
      triggerEdges: [
        ...g.triggerEdges.filter(insideSelection),
        ...plan.innerTriggerEdges,
      ],
      dataEdges: [
        ...g.dataEdges.filter(insideSelection),
        ...plan.innerDataEdges,
      ],
    },
  };
  return {
    nodes: [...g.nodes.filter((n) => !selection.has(n.id)), newGroupNode],
    triggerEdges: [
      ...g.triggerEdges.filter((e) => !touchesSelection(e)),
      ...plan.outerTriggerEdges,
    ],
    dataEdges: [
      ...g.dataEdges.filter((e) => !touchesSelection(e)),
      ...plan.outerDataEdges,
    ],
  };
}

/** A copy of the node under a new id, one step further. */
export function duplicatedNode(node: GraphNode): GraphNode | undefined {
  const [copy] = cloneNodes([node]);
  if (!copy) return undefined;
  return {
    ...copy,
    id: newId(),
    position: {
      x: node.position.x + NEXT_STEP_OFFSET.x,
      y: node.position.y + NEXT_STEP_OFFSET.y,
    },
  };
}

/** The graph with a Retry put in front of the step: the step's incoming wires lead to the Retry, its main outgoing ones leave from it, and the step runs inside the Retry's body. */
export function graphWithRetryAround(
  g: ProcedureGraph,
  node: GraphNode,
  retry: GraphNode,
): ProcedureGraph {
  const triggerEdges = g.triggerEdges.map((e) => {
    if (e.to.node === node.id) return { ...e, to: { ...e.to, node: retry.id } };
    if (
      e.from.node === node.id &&
      (!e.from.branch || e.from.branch === "main")
    ) {
      return { ...e, from: { node: retry.id, branch: "main" } };
    }
    return e;
  });
  triggerEdges.push({
    id: newId(),
    from: { node: retry.id, branch: "body" },
    to: { node: node.id },
  });
  return { ...g, nodes: [...g.nodes, retry], triggerEdges };
}

/** A Retry for the step, placed above it. */
export function retryFor(node: GraphNode): GraphNode {
  return {
    id: newId(),
    kind: "retry",
    config: { maxAttempts: RETRY_MAX_ATTEMPTS },
    position: { x: node.position.x - 40, y: node.position.y - 140 },
  };
}
