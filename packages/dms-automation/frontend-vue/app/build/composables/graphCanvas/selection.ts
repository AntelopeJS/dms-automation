import type { NodeChange } from "@vue-flow/core";
import { watch, type Ref } from "vue";
import type { ProcedureGraph } from "../../../composables/useGraphConnect";
import { SENTINEL_KINDS } from "./types";
import type { CanvasEmits, CanvasProps } from "./types";

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
  // Multi-selection tracking — Vue Flow emits one NodeSelectionChange per
  // affected node when the user box-selects or shift-clicks. We accumulate
  // the current set here and emit a single `selection-change` event with
  // the full list (sentinels filtered out — the user shouldn't be able to
  // fold a sentinel into a new group). The single-node `select:node` event
  // is preserved for the inspector (it expects exactly one node id).
  const selectedNodeIds = new Set<string>();

  // Drop any tracked ids that no longer exist in the current graph (e.g.
  // after navigating to a different procedure / subgraph, or after the
  // "Group selection" action removes the selected nodes). Re-emit if the
  // set shrank. We can't `watch(() => props.graph, ...)` because that
  // fires on every node drag (each emitGraph returns a fresh object).
  watch(
    () => props.graph.nodes,
    (nodes) => {
      if (selectedNodeIds.size === 0) return;
      const valid = new Set(nodes.map((n) => n.id));
      let pruned = false;
      for (const id of [...selectedNodeIds]) {
        if (!valid.has(id)) {
          selectedNodeIds.delete(id);
          pruned = true;
        }
      }
      if (pruned) {
        const ids = [...selectedNodeIds].filter((id) => {
          const n = nodes.find((nn) => nn.id === id);
          return n ? !SENTINEL_KINDS.has(n.kind) : false;
        });
        canvasSelection.value = [...selectedNodeIds];
        emit("selection-change", { ids });
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
      // In read-only mode, still surface selection so the inspector
      // can show node details; suppress position drag and delete.
      if (props.readOnly && c.type !== "select") continue;
      if (c.type === "position" && c.position) {
        // Positions are stored as whole pixels, and a click that moves a
        // node by less than one (a select, not a drag) changes nothing:
        // otherwise selecting a node would count as an unsaved change.
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
        // Sentinel nodes (groupInput / groupOutput) are auto-managed by
        // the editor and never user-deletable. Drop the change silently
        // so keyboard delete + right-click delete both no-op on them.
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
          // Re-point the single-node inspector on deselect: fall back to a
          // still-selected node (most-recent), or clear it once the
          // selection is empty. A click-swap fires `select: true` above in
          // the same batch, which then overrides this.
          const remaining = [...selectedNodeIds];
          emit("select:node", remaining[remaining.length - 1] ?? null);
        }
      }
    }

    if (selectionChanged) {
      // Filter out sentinels — folding them into a new group makes no
      // sense and the toolbar gating depends on a clean set.
      const ids = [...selectedNodeIds].filter((id) => {
        const n = props.graph.nodes.find((nn) => nn.id === id);
        return n ? !SENTINEL_KINDS.has(n.kind) : false;
      });
      canvasSelection.value = [...selectedNodeIds];
      emit("selection-change", { ids });
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

  // DmsFlowCanvas's delete affordance (trash badge on the selected node + the
  // Delete/Backspace key path it now owns) is emit-only: it hands us the ids and
  // we perform the mutation. Route them through onNodesChange's `remove` path so
  // sentinel filtering, edge cleanup, selection sync and emitGraph stay in one
  // place.
  function onDeleteNodes(ids: string[]) {
    if (props.readOnly) return;
    onNodesChange(ids.map((id) => ({ type: "remove", id }) as NodeChange));
  }

  return { onNodesChange, onDeleteNodes };
}
