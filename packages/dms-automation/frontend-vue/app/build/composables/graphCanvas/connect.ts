import type { Connection } from "@vue-flow/core";
import { computed, ref, type Ref } from "vue";
import { newId } from "../../../utils/automation";
import {
  canConnect,
  connectionKind,
  parseDataField,
  parseDataPort,
  parseSourceBranch,
  parseTargetBranch,
} from "../../../composables/useGraphConnect";
import type {
  ConnectResult,
  DataEdge,
  GraphNode as AppGraphNode,
  ProcedureGraph,
  TriggerEdge,
} from "../../../composables/useGraphConnect";
import type {
  CanvasProps,
  CanvasText,
  FlowController,
  NodeHandles,
} from "./types";

/** Whether a connection may be drawn in a graph, and why not. */
export type ConnectionCheck = (
  graph: ProcedureGraph,
  conn: Connection,
) => ConnectResult;

export function connectionCheck(props: Readonly<CanvasProps>): ConnectionCheck {
  return (graph, conn) =>
    canConnect(
      graph,
      props.nodeKinds,
      props.triggerTypes,
      props.actionTypes,
      props.dataNodeTypes,
      conn,
      { parentGroupPorts: props.parentGroupPorts },
    );
}

// The link from `from`'s main output to `to`, when that output is free and
// `to` has an input that accepts it.
export function nextStepConnection(
  graph: ProcedureGraph,
  from: AppGraphNode,
  to: AppGraphNode,
  handlesOf: (node: AppGraphNode) => NodeHandles,
  check: ConnectionCheck,
): Connection | null {
  const out = handlesOf(from).triggerOuts.find((p) => p.name === "main");
  const ins = handlesOf(to).triggerIns;
  const into = ins.find((p) => p.name === "main" || p.name === "") ?? ins[0];
  if (!out || !into) return null;
  if (
    graph.triggerEdges.some(
      (e) => e.from.node === from.id && (e.from.branch ?? "main") === "main",
    )
  )
    return null;
  const conn: Connection = {
    source: from.id,
    sourceHandle: out.id,
    target: to.id,
    targetHandle: into.id,
  };
  return check(graph, conn).ok ? conn : null;
}

// The graph once `conn` is drawn, and the link it took the place of.
export function withConnection(
  graph: ProcedureGraph,
  conn: Connection,
): {
  graph: ProcedureGraph;
  added: TriggerEdge | DataEdge;
  replaced?: TriggerEdge | DataEdge;
} | null {
  const kind = connectionKind(conn.sourceHandle);
  if (kind === "trigger") {
    const branch = parseSourceBranch(conn.sourceHandle);
    const toBranch = parseTargetBranch(conn.targetHandle);
    const newEdge: TriggerEdge = {
      id: newId(),
      from: { node: conn.source, branch },
      to:
        toBranch !== undefined
          ? { node: conn.target, branch: toBranch }
          : { node: conn.target },
    };
    // Each source/branch carries exactly one outgoing trigger edge.
    // Connecting again replaces any existing edge from that source/branch.
    // (Branching across if/switch named branches still works because each
    // branch has its own `from.branch` and only conflicts with itself.)
    const replaced = graph.triggerEdges.find(
      (e) =>
        e.from.node === conn.source && (e.from.branch ?? "main") === branch,
    );
    return {
      graph: {
        ...graph,
        triggerEdges: [
          ...graph.triggerEdges.filter((e) => e !== replaced),
          newEdge,
        ],
      },
      added: newEdge,
      replaced,
    };
  }
  if (kind !== "data") return null;
  const port = parseDataPort(conn.sourceHandle);
  const field = parseDataField(conn.targetHandle);
  if (!port || !field) return null;
  const newEdge: DataEdge = {
    id: newId(),
    from: { node: conn.source, port },
    to: { node: conn.target, field },
  };
  // Overwrite: a field reads from one output only.
  const replaced = graph.dataEdges.find(
    (e) => e.to.node === conn.target && e.to.field === field,
  );
  return {
    graph: {
      ...graph,
      dataEdges: [...graph.dataEdges.filter((e) => e !== replaced), newEdge],
    },
    added: newEdge,
    replaced,
  };
}

export function useConnections({
  props,
  t,
  toast,
  emitGraph,
  menuName,
  check,
  flowRef,
}: {
  props: Readonly<CanvasProps>;
  t: CanvasText["t"];
  toast: ReturnType<typeof useToast>;
  emitGraph: (graph: ProcedureGraph) => void;
  menuName: (id: string) => string;
  check: ConnectionCheck;
  flowRef: Ref<FlowController | null>;
}) {
  function refusalText(result: ConnectResult): string {
    return result.ok
      ? ""
      : t(
          `dms_automation.editor.canvas.connect.${result.code}`,
          result.params ?? {},
        );
  }

  // Undo of a replacement: the new link goes, the old one comes back — unless
  // the new link is gone already, or an end of the old one was deleted since.
  function restoreLink(
    added: TriggerEdge | DataEdge,
    old: TriggerEdge | DataEdge,
  ) {
    const graph = props.graph;
    const ids = new Set(graph.nodes.map((n) => n.id));
    const back = ids.has(old.from.node) && ids.has(old.to.node);
    if ("port" in added.from) {
      if (!graph.dataEdges.some((e) => e.id === added.id)) return;
      const edges = graph.dataEdges.filter((e) => e.id !== added.id);
      emitGraph({
        ...graph,
        dataEdges: back ? [...edges, old as DataEdge] : edges,
      });
    } else {
      if (!graph.triggerEdges.some((e) => e.id === added.id)) return;
      const edges = graph.triggerEdges.filter((e) => e.id !== added.id);
      emitGraph({
        ...graph,
        triggerEdges: back ? [...edges, old as TriggerEdge] : edges,
      });
    }
  }

  // Drawing over an existing link replaces it: say which one, with an undo of
  // that replacement only.
  function notifyReplaced(
    added: TriggerEdge | DataEdge,
    old: TriggerEdge | DataEdge,
    conn: Connection,
  ) {
    let description: string;
    if ("port" in old.from) {
      const port = parseDataPort(conn.sourceHandle);
      if (old.from.node === conn.source && old.from.port === port) return;
      description = t("dms_automation.editor.canvas.replaced.data", {
        field: (old as DataEdge).to.field,
        step: menuName(conn.target),
        source: `${menuName(conn.source)} · ${port}`,
        previous: `${menuName(old.from.node)} · ${old.from.port}`,
      });
    } else {
      if (old.to.node === conn.target) return;
      description = t("dms_automation.editor.canvas.replaced.trigger", {
        source: menuName(conn.source),
        target: menuName(conn.target),
        previous: menuName(old.to.node),
      });
    }
    toast.add({
      title: t("dms_automation.editor.canvas.replaced.title"),
      description,
      color: "info",
      icon: "i-ph-arrows-left-right",
      actions: [
        {
          label: t("dms_automation.editor.canvas.undo"),
          onClick: () => restoreLink(added, old),
        },
      ],
    });
  }

  function onConnect(conn: Connection) {
    if (props.readOnly) return;
    const result = check(props.graph, conn);
    if (!result.ok) {
      toast.add({
        title: t("dms_automation.editor.canvas.connect.title"),
        description: refusalText(result),
        color: "warning",
        icon: "i-ph-warning",
      });
      return;
    }
    const next = withConnection(props.graph, conn);
    if (!next) return;
    emitGraph(next.graph);
    if (next.replaced) notifyReplaced(next.added, next.replaced, conn);
  }

  // Why the port under a link being drawn refuses it, shown while it hovers.
  const refusal = ref("");

  const refusalShown = computed(
    () => flowRef.value?.connectionStatus === "invalid" && refusal.value !== "",
  );

  function isValidConnection(conn: Connection): boolean {
    const result = check(props.graph, conn);
    refusal.value = refusalText(result);
    return result.ok;
  }

  // Released over a port that refuses the link: keep the reason on screen.
  function onConnectEnd() {
    if (refusalShown.value) {
      toast.add({
        title: t("dms_automation.editor.canvas.connect.title"),
        description: refusal.value,
        color: "warning",
        icon: "i-ph-warning",
      });
    }
    refusal.value = "";
  }

  return { onConnect, refusal, refusalShown, isValidConnection, onConnectEnd };
}
