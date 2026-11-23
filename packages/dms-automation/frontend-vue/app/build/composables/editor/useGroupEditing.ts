import { computed, nextTick } from "vue";
import type { EditorContext } from "./useEditorContext";
import type {
  GraphNode,
  GroupPort,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import { newId } from "../../../utils/automation";
import { cloneGraph } from "../../utils/editor/graphShape";
import {
  detectPortRenames,
  syncSentinels,
} from "../../utils/editor/groupPorts";
import { planNewGroup } from "../../utils/editor/groupPlan";
import {
  canGroupNodes,
  duplicatedNode,
  graphWithNewGroup,
  graphWithRenamedGroupPorts,
  graphWithRetryAround,
  groupWithPorts,
  renameSentinelEdges,
  retryFor,
} from "./groupEdits";
import type { SubgraphNavigation } from "./useSubgraphNavigation";

/** The ports of a group, and of the template being edited at its root. */
function usePortEditing(ctx: EditorContext, nav: SubgraphNavigation) {
  const {
    currentGraph,
    editorMode,
    selected,
    selectedNode,
    subgraphPath,
    templatePorts,
  } = ctx;
  const { onGraphUpdate, onUpdateNode } = nav;

  function onPortsUpdate(payload: { nodeId: string; ports: GroupPort[] }) {
    const g = currentGraph.value;
    if (!g) return;
    const existing = g.nodes.find(
      (n) => n.id === payload.nodeId && n.kind === "group",
    );
    if (!existing || existing.templateId) return;
    const renames = detectPortRenames(
      Array.isArray(existing.ports) ? existing.ports : [],
      payload.ports,
    );
    const clonedGroup = groupWithPorts(existing, payload.ports, renames);
    if (renames.length > 0) {
      onGraphUpdate(graphWithRenamedGroupPorts(g, clonedGroup, renames));
      return;
    }
    onUpdateNode(clonedGroup);
  }

  const showTemplatePorts = computed<boolean>(
    () =>
      editorMode.value === "template" &&
      subgraphPath.value.length <= 1 &&
      (!selectedNode.value ||
        selectedNode.value.kind === "groupInput" ||
        selectedNode.value.kind === "groupOutput"),
  );

  function onTemplatePortsUpdate(next: GroupPort[]) {
    const root = selected.value?.graph;
    if (!root) return;
    const ports = next.map((p) => ({ ...p }));
    const subgraph = cloneGraph(root);
    const template: GraphNode = {
      id: "",
      kind: "group",
      config: {},
      position: { x: 0, y: 0 },
      ports,
      subgraph,
    };
    renameSentinelEdges(subgraph, detectPortRenames(templatePorts.value, next));
    syncSentinels(template);
    templatePorts.value = ports;
    onGraphUpdate(subgraph);
  }

  return { onPortsUpdate, showTemplatePorts, onTemplatePortsUpdate };
}

/** Creating a group out of the selection, and focusing the inspector's name field on it. */
function useGroupCreation(ctx: EditorContext, nav: SubgraphNavigation) {
  const {
    actionTypes,
    currentGraph,
    dataNodeTypes,
    inspectorRef,
    isCurrentGraphReadOnly,
    nodeKinds,
    selected,
    selectedNodeId,
    selectedNodeIds,
    t,
    triggerTypes,
  } = ctx;
  const schemaSources = {
    currentGraph,
    nodeKinds,
    triggerTypes,
    actionTypes,
    dataNodeTypes,
  };

  const canGroupSelection = computed<boolean>(() => {
    const g = currentGraph.value;
    if (!selected.value || isCurrentGraphReadOnly.value || !g) return false;
    const ids = selectedNodeIds.value;
    return ids.length > 0 && canGroupNodes(g, new Set(ids));
  });

  async function focusInspectorName() {
    await nextTick();
    const input = inspectorRef.value?.querySelector("input");
    input?.focus();
    input?.select();
  }

  function createGroupFromSelection() {
    if (!canGroupSelection.value) return;
    const g = currentGraph.value;
    if (!g) return;
    const selection = new Set(selectedNodeIds.value);
    if (selection.size === 0) return;
    const inputName = t("dms_automation.editor.groupDefaultName");
    const groupId = newId();
    const plan = planNewGroup(g, selection, groupId, schemaSources);
    const nextGraph = graphWithNewGroup(g, selection, inputName, plan);
    selectedNodeIds.value = [];
    selectedNodeId.value = groupId;
    nav.onGraphUpdate(nextGraph);
    void focusInspectorName();
  }

  return { canGroupSelection, createGroupFromSelection, focusInspectorName };
}

/** The edits the builder makes to the groups and the steps of the open graph. */
export function useGroupEditing(ctx: EditorContext, nav: SubgraphNavigation) {
  const { currentGraph, isCurrentGraphReadOnly, selectedNode, selectedNodeId } =
    ctx;
  const { onGraphUpdate } = nav;

  function onUnwireField(payload: { field: string }) {
    const g = currentGraph.value;
    if (!g || !selectedNode.value) return;
    const nodeId = selectedNode.value.id;
    const nextGraph: ProcedureGraph = {
      ...g,
      dataEdges: g.dataEdges.filter(
        (e) => !(e.to.node === nodeId && e.to.field === payload.field),
      ),
    };
    onGraphUpdate(nextGraph);
  }

  function onDeleteNode(payload: { id: string }) {
    const g = currentGraph.value;
    if (!g || isCurrentGraphReadOnly.value) return;
    const id = payload.id;
    const nextGraph: ProcedureGraph = {
      ...g,
      nodes: g.nodes.filter((n) => n.id !== id),
      triggerEdges: g.triggerEdges.filter(
        (e) => e.from.node !== id && e.to.node !== id,
      ),
      dataEdges: g.dataEdges.filter(
        (e) => e.from.node !== id && e.to.node !== id,
      ),
    };
    if (selectedNodeId.value === id) selectedNodeId.value = null;
    onGraphUpdate(nextGraph);
  }

  function onDuplicateNode(payload: { id: string }) {
    const g = currentGraph.value;
    if (!g || isCurrentGraphReadOnly.value) return;
    const node = g.nodes.find((n) => n.id === payload.id);
    const copy = node && duplicatedNode(node);
    if (!copy) return;
    onGraphUpdate({ ...g, nodes: [...g.nodes, copy] });
    selectedNodeId.value = copy.id;
  }

  function onWrapInRetry(payload: { id: string }) {
    const g = currentGraph.value;
    if (!g || isCurrentGraphReadOnly.value) return;
    const node = g.nodes.find((n) => n.id === payload.id);
    if (!node) return;
    const retry = retryFor(node);
    onGraphUpdate(graphWithRetryAround(g, node, retry));
    selectedNodeId.value = retry.id;
  }

  return {
    ...usePortEditing(ctx, nav),
    ...useGroupCreation(ctx, nav),
    onUnwireField,
    onDeleteNode,
    onDuplicateNode,
    onWrapInRetry,
  };
}

export type GroupEditing = ReturnType<typeof useGroupEditing>;
