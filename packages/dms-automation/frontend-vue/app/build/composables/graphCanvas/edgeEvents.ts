import type { Connection, EdgeChange, Edge as VfEdge } from "@vue-flow/core";
import type { Ref } from "vue";
import {
  parseDataField,
  parseDataPort,
  parseSourceBranch,
  parseTargetBranch,
} from "../../../composables/useGraphConnect";
import type { ProcedureGraph } from "../../../composables/useGraphConnect";
import type { CanvasEmits, CanvasProps, FlowController } from "./types";

type EdgeKind = "trigger" | "data";

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function withoutEdges(
  graph: ProcedureGraph,
  ids: string[],
): ProcedureGraph | null {
  let nextTrigger = graph.triggerEdges;
  let nextData = graph.dataEdges;
  let changed = false;
  for (const id of ids) {
    const beforeT = nextTrigger.length;
    nextTrigger = nextTrigger.filter((e) => e.id !== id);
    if (nextTrigger.length !== beforeT) {
      changed = true;
      continue;
    }
    const beforeD = nextData.length;
    nextData = nextData.filter((e) => e.id !== id);
    if (nextData.length !== beforeD) changed = true;
  }
  return changed
    ? { ...graph, triggerEdges: nextTrigger, dataEdges: nextData }
    : null;
}

function reconnected(
  graph: ProcedureGraph,
  edge: VfEdge<{ kind?: EdgeKind }>,
  connection: Connection,
): ProcedureGraph | null {
  const kind = edge.data?.kind;
  if (kind === "trigger") {
    const branch = parseSourceBranch(connection.sourceHandle);
    const toBranch = parseTargetBranch(connection.targetHandle);
    const triggerEdges = graph.triggerEdges.map((e) =>
      e.id === edge.id
        ? {
            ...e,
            from: { node: connection.source, branch },
            to:
              toBranch !== undefined
                ? { node: connection.target, branch: toBranch }
                : { node: connection.target },
          }
        : e,
    );
    return { ...graph, triggerEdges };
  }
  if (kind === "data") {
    const port = parseDataPort(connection.sourceHandle);
    const field = parseDataField(connection.targetHandle);
    if (!port || !field) return null;
    const dataEdges = graph.dataEdges.map((e) =>
      e.id === edge.id
        ? {
            ...e,
            from: { node: connection.source, port },
            to: { node: connection.target, field },
          }
        : e,
    );
    return { ...graph, dataEdges };
  }
  return null;
}

/**
 * The edge handlers of the canvas.
 *
 * Dragging an existing edge's endpoint reattaches or deletes it: the start
 * clears a success flag, the update (fired only for a drop on a valid target)
 * sets it and rewrites the edge, and the end (fired always) deletes the edge
 * when no update happened, that is a drop in empty space.
 *
 * The DMS canvas deletes the selected nodes on Delete and Backspace, not the
 * selected links: `onKeydown` removes those (a deleted node takes its links
 * along). Only a group's double-click is signalled (`group:enter`): the other
 * kinds are reserved for inline edit affordances.
 */
export function useEdgeEvents({
  props,
  emit,
  flowRef,
  emitGraph,
}: {
  props: Readonly<CanvasProps>;
  emit: CanvasEmits;
  flowRef: Ref<FlowController | null>;
  emitGraph: (graph: ProcedureGraph) => void;
}) {
  function removeEdges(ids: string[]) {
    const next = withoutEdges(props.graph, ids);
    if (next) emitGraph(next);
  }

  function onEdgesChange(changes: EdgeChange[]) {
    if (props.readOnly) return;
    removeEdges(changes.flatMap((c) => (c.type === "remove" ? [c.id] : [])));
  }

  function onKeydown(event: KeyboardEvent) {
    if (props.readOnly || (event.key !== "Delete" && event.key !== "Backspace"))
      return;
    if (isTypingTarget(event.target)) return;
    const flow = flowRef.value;
    if (
      !flow ||
      flow.getSelectedNodes.length > 0 ||
      flow.getSelectedEdges.length === 0
    )
      return;
    event.preventDefault();
    removeEdges(flow.getSelectedEdges.map((e) => e.id));
  }

  let edgeUpdateSuccessful = false;
  function onEdgeUpdateStart() {
    edgeUpdateSuccessful = false;
  }

  function onEdgeUpdate(payload: {
    event: MouseEvent;
    edge: VfEdge<{ kind?: EdgeKind }>;
    connection: Connection;
  }) {
    edgeUpdateSuccessful = true;
    const next = reconnected(props.graph, payload.edge, payload.connection);
    if (next) emitGraph(next);
  }

  function onNodeDoubleClick(payload: {
    event: MouseEvent;
    node: { id: string; type?: string };
  }) {
    if (payload.node?.type !== "group") return;
    emit("group:enter", { id: payload.node.id });
  }

  function onEdgeUpdateEnd(payload: { event: MouseEvent; edge: VfEdge }) {
    if (edgeUpdateSuccessful) return;
    const { edge } = payload;
    if (!edge) return;
    removeEdges([edge.id]);
  }

  return {
    onEdgesChange,
    onKeydown,
    onEdgeUpdateStart,
    onEdgeUpdate,
    onNodeDoubleClick,
    onEdgeUpdateEnd,
  };
}
