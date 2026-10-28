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
  function onEdgesChange(changes: EdgeChange[]) {
    if (props.readOnly) return;
    let nextTrigger = props.graph.triggerEdges;
    let nextData = props.graph.dataEdges;
    let changed = false;

    for (const c of changes) {
      if (c.type === "remove") {
        const beforeT = nextTrigger.length;
        nextTrigger = nextTrigger.filter((e) => e.id !== c.id);
        if (nextTrigger.length !== beforeT) {
          changed = true;
          continue;
        }
        const beforeD = nextData.length;
        nextData = nextData.filter((e) => e.id !== c.id);
        if (nextData.length !== beforeD) changed = true;
      }
    }

    if (changed) {
      emitGraph({
        ...props.graph,
        triggerEdges: nextTrigger,
        dataEdges: nextData,
      });
    }
  }

  // The DMS canvas deletes the selected nodes on Delete / Backspace, not the
  // selected links: remove those here (a deleted node takes its links along).
  function onKeydown(event: KeyboardEvent) {
    if (props.readOnly || (event.key !== "Delete" && event.key !== "Backspace"))
      return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    )
      return;
    const flow = flowRef.value;
    if (
      !flow ||
      flow.getSelectedNodes.length > 0 ||
      flow.getSelectedEdges.length === 0
    )
      return;
    event.preventDefault();
    onEdgesChange(
      flow.getSelectedEdges.map(
        (e) => ({ type: "remove", id: e.id }) as EdgeChange,
      ),
    );
  }

  // Edge-update flow (drag an existing edge's endpoint to reattach or delete):
  //   1. @edge-update-start clears the success flag.
  //   2. @edge-update fires only if the user drops on a valid target — mark
  //      successful and rewrite the edge with the new connection.
  //   3. @edge-update-end fires unconditionally; if no successful update
  //      happened, the user dropped in empty space → delete the edge.
  let edgeUpdateSuccessful = false;
  function onEdgeUpdateStart() {
    edgeUpdateSuccessful = false;
  }

  function onEdgeUpdate(payload: {
    event: MouseEvent;
    edge: VfEdge;
    connection: Connection;
  }) {
    edgeUpdateSuccessful = true;
    const { edge, connection } = payload;
    const kind = (edge.data as { kind?: "trigger" | "data" } | undefined)?.kind;
    if (kind === "trigger") {
      const branch = parseSourceBranch(connection.sourceHandle);
      const toBranch = parseTargetBranch(connection.targetHandle);
      const nextTrigger = props.graph.triggerEdges.map((e) =>
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
      emitGraph({ ...props.graph, triggerEdges: nextTrigger });
    } else if (kind === "data") {
      const port = parseDataPort(connection.sourceHandle);
      const field = parseDataField(connection.targetHandle);
      if (!port || !field) return;
      const nextData = props.graph.dataEdges.map((e) =>
        e.id === edge.id
          ? {
              ...e,
              from: { node: connection.source, port },
              to: { node: connection.target, field },
            }
          : e,
      );
      emitGraph({ ...props.graph, dataEdges: nextData });
    }
  }

  // Vue Flow fires @node-double-click with a single `{ event, node }` payload.
  // Filter to group nodes so Editor.vue receives a clean group:enter signal —
  // double-clicking any other node kind is reserved for future inline edit
  // affordances.
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
    const nextTrigger = props.graph.triggerEdges.filter(
      (e) => e.id !== edge.id,
    );
    const nextData = props.graph.dataEdges.filter((e) => e.id !== edge.id);
    if (
      nextTrigger.length === props.graph.triggerEdges.length &&
      nextData.length === props.graph.dataEdges.length
    ) {
      return;
    }
    emitGraph({
      ...props.graph,
      triggerEdges: nextTrigger,
      dataEdges: nextData,
    });
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
