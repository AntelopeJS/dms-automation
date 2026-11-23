import { computed, watch } from "vue";
import type { BreadcrumbItem } from "@nuxt/ui";
import type { EditorContext, TemplateInstanceSeed } from "./useEditorContext";
import type {
  GraphNode,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import { cloneGraph } from "../../utils/editor/graphShape";
import type { SubgraphPathSegment } from "../../types/editor";
import type { GraphHistory } from "./useGraphHistory";
import type { EditorLoad } from "./useEditorLoad";
import { configName } from "./valueGuards";

function breadcrumbIcon(kind: SubgraphPathSegment["kind"]): string {
  if (kind === "procedure") return "i-ph-flow-arrow";
  return kind === "template" ? "i-ph-link" : "i-ph-package";
}

/**
 * The procedure graph with `inner` as the subgraph of the group `path` ends at, or null when the path no longer leads to a group. The chain from the root down is cloned so Vue's reactivity sees a fresh top-level graph: history keys structuralKey() off node identity at every level.
 */
function graphWithInnerGraph(
  root: ProcedureGraph,
  path: SubgraphPathSegment[],
  inner: ProcedureGraph,
): ProcedureGraph | null {
  const rootGraph = cloneGraph(root);
  let containerNodes = rootGraph.nodes;
  for (const [offset, seg] of path.slice(1).entries()) {
    const idx = containerNodes.findIndex(
      (n) => n.id === seg.id && n.kind === "group",
    );
    const original = containerNodes[idx];
    if (!original) return null;
    const cloned: GraphNode = { ...original };
    containerNodes[idx] = cloned;
    if (offset === path.length - 2) {
      cloned.subgraph = inner;
    } else {
      if (!cloned.subgraph) return null;
      cloned.subgraph = {
        ...cloned.subgraph,
        nodes: [...cloned.subgraph.nodes],
      };
      containerNodes = cloned.subgraph.nodes;
    }
  }
  return rootGraph;
}

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

/** What follows the open procedure: the path is pruned when a group it goes through is deleted, the root segment takes renames, another procedure reseeds the path and the history, and the template read opens the template it answers. */
function watchSubgraphState(
  ctx: EditorContext,
  history: GraphHistory,
  load: EditorLoad,
) {
  const {
    editorMode,
    selected,
    selectedId,
    selectedNodeId,
    subgraphFrames,
    subgraphPath,
  } = ctx;
  const { initHistoryAndSaved } = history;
  const { openTemplate, templateRead } = load;
  watch(
    () => subgraphFrames.value.length,
    (framesLen) => {
      if (framesLen > 0 && framesLen < subgraphPath.value.length) {
        subgraphPath.value = subgraphPath.value.slice(0, framesLen);
        selectedNodeId.value = null;
      }
    },
  );

  watch(
    () => selected.value?.name,
    (name) => {
      const first = subgraphPath.value[0];
      if (first && first.kind === "procedure" && name) first.name = name;
    },
  );

  watch(selectedId, () => {
    selectedNodeId.value = null;
    initHistoryAndSaved();
    seedSubgraphPath(ctx);
  });

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
}

/** Moving through the groups of the open procedure, and writing the canvas's graph back. */
export function useSubgraphNavigation(
  ctx: EditorContext,
  history: GraphHistory,
  load: EditorLoad,
) {
  const {
    currentGraph,
    graphCanvasRef,
    selected,
    selectedNode,
    selectedNodeId,
    subgraphPath,
    t,
  } = ctx;
  const { pushHistory } = history;
  watchSubgraphState(ctx, history, load);

  const breadcrumbItems = computed<BreadcrumbItem[]>(() =>
    subgraphPath.value.map((seg, idx) => ({
      label: seg.name,
      icon: breadcrumbIcon(seg.kind),
      onSelect: (ev: Event) => {
        ev.preventDefault();
        if (idx < subgraphPath.value.length - 1) {
          subgraphPath.value = subgraphPath.value.slice(0, idx + 1);
          selectedNodeId.value = null;
        }
      },
    })),
  );

  function exitSubgraph() {
    subgraphPath.value = subgraphPath.value.slice(0, -1);
    selectedNodeId.value = null;
  }

  function onGraphUpdate(g: ProcedureGraph) {
    if (!selected.value) return;
    const path = subgraphPath.value;
    if (path.length <= 1) {
      selected.value.graph = g;
      pushHistory(g, true);
      return;
    }
    const rootGraph = graphWithInnerGraph(selected.value.graph, path, g);
    if (!rootGraph) return;
    selected.value.graph = rootGraph;
    pushHistory(rootGraph, true);
  }

  function onSelectNode(id: string | null) {
    selectedNodeId.value = id;
  }

  function onPaletteAddNode(payload: { kind: string; typeId?: string }) {
    graphCanvasRef.value?.addNode(payload.kind, payload.typeId);
  }
  function onPaletteAddTemplate(template: TemplateInstanceSeed) {
    graphCanvasRef.value?.addTemplateInstance(template);
  }

  function groupName(node: GraphNode): string {
    return (
      node.label ||
      configName(node) ||
      t("dms_automation.editor.groupDefaultName")
    );
  }

  function onGroupEnter(payload: { id: string }) {
    const g = currentGraph.value;
    if (!g) return;
    const node = g.nodes.find((n) => n.id === payload.id && n.kind === "group");
    if (!node) return;
    if (node.templateId && !node.subgraph) return;
    const name = groupName(node);
    subgraphPath.value = [
      ...subgraphPath.value,
      { kind: "group", id: node.id, name },
    ];
    selectedNodeId.value = null;
  }

  const canEnterGroup = computed<boolean>(() => {
    const n = selectedNode.value;
    if (!n || n.kind !== "group") return false;
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
