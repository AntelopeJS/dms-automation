import { computed, watch } from "vue";
import type { BreadcrumbItem } from "@nuxt/ui";
import type { EditorContext } from "./useEditorContext";
import type {
  GraphNode,
  GroupPort,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import { cloneGraph } from "../../utils/editor/graphShape";
import type { GraphHistory } from "./useGraphHistory";
import type { EditorLoad } from "./useEditorLoad";

/**
 * Seeds the path with the root segment: the procedure, or in template mode the
 * template itself.
 */
export function seedSubgraphPath({
  selected,
  editorMode,
  subgraphPath,
}: EditorContext) {
  const p = selected.value;
  if (!p) {
    subgraphPath.value = [];
    return;
  }
  // In template mode the root segment is the template itself (we reuse the
  // 'template' kind already declared on SubgraphPathSegment). The breadcrumb
  // renders it with the i-ph-link icon, which is exactly what we want for
  // "Templates ▸ <name>".
  if (editorMode.value === "template") {
    subgraphPath.value = [
      { kind: "template", id: p._id, name: p.name || "Template" },
    ];
    return;
  }
  subgraphPath.value = [
    { kind: "procedure", id: p._id, name: p.name || "Procedure" },
  ];
}

/** Moving through the groups of the open procedure, and writing the canvas's graph back. */
export function useSubgraphNavigation(
  ctx: EditorContext,
  history: GraphHistory,
  load: EditorLoad,
) {
  const {
    currentGraph,
    editorMode,
    graphCanvasRef,
    selected,
    selectedId,
    selectedNode,
    selectedNodeId,
    subgraphFrames,
    subgraphPath,
    t,
  } = ctx;
  const { initHistoryAndSaved, pushHistory } = history;
  const { openTemplate, templateRead } = load;

  const breadcrumbItems = computed<BreadcrumbItem[]>(() =>
    subgraphPath.value.map((seg, idx) => ({
      label: seg.name,
      icon:
        seg.kind === "procedure"
          ? "i-ph-flow-arrow"
          : seg.kind === "template"
            ? "i-ph-link"
            : "i-ph-package",
      // onSelect fires for clicks; popping the path to `idx + 1` keeps
      // the clicked segment and discards everything deeper.
      onSelect: (ev: Event) => {
        ev.preventDefault();
        if (idx < subgraphPath.value.length - 1) {
          subgraphPath.value = subgraphPath.value.slice(0, idx + 1);
          // Clear node selection — the old selected node id may not
          // exist in the new current graph.
          selectedNodeId.value = null;
        }
      },
    })),
  );

  // If the user deletes a group node from an outer graph while their path
  // points into its subgraph, prune the path back to the deepest valid
  // frame. Cheap because subgraphFrames already does the traversal.
  watch(
    () => subgraphFrames.value.length,
    (framesLen) => {
      if (framesLen > 0 && framesLen < subgraphPath.value.length) {
        subgraphPath.value = subgraphPath.value.slice(0, framesLen);
        selectedNodeId.value = null;
      }
    },
  );

  // Keep the procedure-root breadcrumb label in sync with renames.
  watch(
    () => selected.value?.name,
    (name) => {
      const first = subgraphPath.value[0];
      if (first && first.kind === "procedure" && name) first.name = name;
    },
  );

  function exitSubgraph() {
    subgraphPath.value = subgraphPath.value.slice(0, -1);
    selectedNodeId.value = null;
  }

  function onGraphUpdate(g: ProcedureGraph) {
    if (!selected.value) return;
    const path = subgraphPath.value;
    if (path.length <= 1) {
      // At procedure root — write straight through, same as before
      // subgraph navigation existed.
      selected.value.graph = g;
      pushHistory(g, true);
      return;
    }
    // At a deeper level — `g` is the subgraph of the deepest group node.
    // Walk the path from the outer procedure graph down, cloning the
    // chain so Vue's reactivity sees a fresh top-level graph (history
    // keys structuralKey() off node identity at every level).
    const rootGraph = cloneGraph(selected.value.graph);
    let containerNodes = rootGraph.nodes;
    for (let i = 1; i < path.length; i++) {
      const seg = path[i]!;
      const idx = containerNodes.findIndex(
        (n) => n.id === seg.id && n.kind === "group",
      );
      if (idx === -1) {
        // Path was stale — bail out without mutating; the watch on
        // subgraphFrames.length will prune the path.
        return;
      }
      // Replace the node at idx with a shallow clone so we can mutate
      // its `subgraph` without aliasing back into the original (the
      // outer graph already came from cloneGraph above, so its node
      // objects are fresh too — but the inner subgraph reference
      // chain needs explicit substitution).
      const cloned: GraphNode = { ...containerNodes[idx]! };
      containerNodes[idx] = cloned;
      if (i === path.length - 1) {
        cloned.subgraph = g;
      } else {
        // Mid-chain — keep walking, ensuring each intermediate
        // subgraph is also a fresh object for the next iteration's
        // nodes array.
        if (!cloned.subgraph) return;
        cloned.subgraph = {
          ...cloned.subgraph,
          nodes: [...cloned.subgraph.nodes],
        };
        containerNodes = cloned.subgraph.nodes;
      }
    }
    selected.value.graph = rootGraph;
    pushHistory(rootGraph, true);
  }

  function onSelectNode(id: string | null) {
    selectedNodeId.value = id;
  }

  function onPaletteAddNode(payload: { kind: string; typeId?: string }) {
    graphCanvasRef.value?.addNode(payload.kind, payload.typeId);
  }
  function onPaletteAddTemplate(template: {
    _id: string;
    name: string;
    icon?: string;
    ports: GroupPort[];
  }) {
    graphCanvasRef.value?.addTemplateInstance(template);
  }

  watch(selectedId, () => {
    selectedNodeId.value = null;
    initHistoryAndSaved();
    seedSubgraphPath(ctx);
  });

  // `?template=<id>` changed while the editor stayed mounted (Editor is
  // mounted once per route navigation, so this is mostly a guard for in-place
  // query updates, e.g. catalog "Edit" buttons using router.push): the template
  // read follows the URL, and the editor opens what it answers.
  watch(
    () => templateRead.status.value,
    (status) => {
      if (
        editorMode.value === "template" &&
        (status === "success" || status === "error")
      )
        openTemplate();
    },
  );

  function groupName(node: GraphNode): string {
    return (
      node.label ||
      (node.config?.name as string | undefined) ||
      t("dms_automation.editor.groupDefaultName")
    );
  }

  function onGroupEnter(payload: { id: string }) {
    const g = currentGraph.value;
    if (!g) return;
    const node = g.nodes.find((n) => n.id === payload.id && n.kind === "group");
    if (!node) return;
    // Template instances have no inline subgraph — the frame walker would
    // stop at this segment and the watcher would prune it back. Bail early so
    // the path doesn't briefly include a doomed segment.
    if (node.templateId && !node.subgraph) return;
    const name = groupName(node);
    subgraphPath.value = [
      ...subgraphPath.value,
      { kind: "group", id: node.id, name },
    ];
    selectedNodeId.value = null;
  }

  // "Enter group" affordance — true iff the currently selected node is a group
  // (local, or a template instance with a resolved subgraph). Read-only state

  // Drives the toolbar button, the inspector button, and the Tab keybinding.
  const canEnterGroup = computed<boolean>(() => {
    const n = selectedNode.value;
    if (!n || n.kind !== "group") return false;
    // Template instances need a resolved subgraph to navigate into; without
    // one we can't render the inner view.
    if (n.templateId && !n.subgraph) return false;
    return true;
  });

  function enterSelectedGroup() {
    const n = selectedNode.value;
    if (!n || n.kind !== "group") return;
    onGroupEnter({ id: n.id });
  }

  function onUpdateNode(updated: GraphNode) {
    const g = currentGraph.value;
    if (!g) return;
    const nextGraph: ProcedureGraph = {
      ...g,
      nodes: g.nodes.map((n) => (n.id === updated.id ? updated : n)),
    };
    onGraphUpdate(nextGraph);
  }

  return {
    breadcrumbItems,
    exitSubgraph,
    onGraphUpdate,
    onSelectNode,
    onPaletteAddNode,
    onPaletteAddTemplate,
    groupName,
    onGroupEnter,
    canEnterGroup,
    enterSelectedGroup,
    onUpdateNode,
  };
}

export type SubgraphNavigation = ReturnType<typeof useSubgraphNavigation>;
