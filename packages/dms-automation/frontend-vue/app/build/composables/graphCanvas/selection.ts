import type { NodeChange } from "@vue-flow/core";
import { watch, type Ref } from "vue";
import type {
  GraphNode,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import { SENTINEL_KINDS } from "./types";
import type { CanvasEmits, CanvasProps } from "./types";

function selectableIds(selected: Set<string>, nodes: GraphNode[]): string[] {
  return [...selected].filter((id) => {
    const n = nodes.find((nn) => nn.id === id);
    return n ? !SENTINEL_KINDS.has(n.kind) : false;
  });
}

/**
 * Tracks the selection Vue Flow reports, one change per affected node, and
 * emits one `selection-change` with the whole set, sentinels excluded (they
 * cannot be folded into a group). `select:node` stays for the inspector, which
 * expects exactly one node id. Ids that left the graph are dropped by watching
 * its nodes: the graph itself changes on every drag.
 *
 * Positions are stored as whole pixels, and a move of less than one (a click
 * that selects) changes nothing: otherwise selecting a node would count as an
 * unsaved change. Sentinels are never removed, and a read-only canvas still
 * selects.
 *
 * DmsFlowCanvas's delete affordance (the trash badge and the Delete and
 * Backspace keys) only hands over the ids: `onDeleteNodes` sends them through
 * the `remove` path of `onNodesChange`, which keeps sentinel filtering, edge
 * cleanup and selection sync in one place.
 */
export function useCanvasSelection({
  props,
  emit,
  canvasSelection,
  emitGraph,
}: {
  props: Readonly<CanvasProps>;
  emit: CanvasEmits;
  canvasSelection: Ref<string[]>;
  emitGraph: (graph: ProcedureGraph) => void;
}) {
  const selectedNodeIds = new Set<string>();

  watch(
    () => props.graph.nodes,
    (nodes) => {
      if (selectedNodeIds.size === 0) return;
      const valid = new Set(nodes.map((n) => n.id));
      let pruned = false;
      for (const id of selectedNodeIds) {
        if (!valid.has(id)) {
          selectedNodeIds.delete(id);
          pruned = true;
        }
      }
      if (pruned) {
        canvasSelection.value = [...selectedNodeIds];
        emit("selection-change", {
          ids: selectableIds(selectedNodeIds, nodes),
        });
      }
    },
  );

  function onNodesChange(changes: NodeChange[]) {
    let nextNodes = props.graph.nodes;
    let nextTrigger = props.graph.triggerEdges;
    let nextData = props.graph.dataEdges;
    let changed = false;
    let selectionChanged = false;

    for (const c of changes) {
      if (props.readOnly && c.type !== "select") continue;
      if (c.type === "position" && c.position) {
        const pos = {
          x: Math.round(c.position.x),
          y: Math.round(c.position.y),
        };
        const current = nextNodes.find((n) => n.id === c.id);
        if (
          current &&
          current.position.x === pos.x &&
          current.position.y === pos.y
        )
          continue;
        nextNodes = nextNodes.map((n) =>
          n.id === c.id ? { ...n, position: pos } : n,
        );
        changed = true;
      } else if (c.type === "remove") {
        const victim = nextNodes.find((n) => n.id === c.id);
        if (victim && SENTINEL_KINDS.has(victim.kind)) continue;
        nextNodes = nextNodes.filter((n) => n.id !== c.id);
        nextTrigger = nextTrigger.filter(
          (e) => e.from.node !== c.id && e.to.node !== c.id,
        );
        nextData = nextData.filter(
          (e) => e.from.node !== c.id && e.to.node !== c.id,
        );
        if (selectedNodeIds.delete(c.id)) selectionChanged = true;
        changed = true;
      } else if (c.type === "select") {
        if (c.selected) {
          if (!selectedNodeIds.has(c.id)) {
            selectedNodeIds.add(c.id);
            selectionChanged = true;
          }
          emit("select:node", c.id);
        } else {
          if (selectedNodeIds.delete(c.id)) selectionChanged = true;
          const remaining = [...selectedNodeIds];
          emit("select:node", remaining[remaining.length - 1] ?? null);
        }
      }
    }

    if (selectionChanged) {
      canvasSelection.value = [...selectedNodeIds];
      emit("selection-change", {
        ids: selectableIds(selectedNodeIds, props.graph.nodes),
      });
    }

    if (changed) {
      emitGraph({
        ...props.graph,
        nodes: nextNodes,
        triggerEdges: nextTrigger,
        dataEdges: nextData,
      });
    }
  }

  function onDeleteNodes(ids: string[]) {
    if (props.readOnly) return;
    onNodesChange(ids.map((id): NodeChange => ({ type: "remove", id })));
  }

  return { onNodesChange, onDeleteNodes };
}
