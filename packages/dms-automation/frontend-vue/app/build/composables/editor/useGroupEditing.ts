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
  applyPortRenamesToEdges,
  detectPortRenames,
  syncSentinels,
} from "../../utils/editor/groupPorts";
import { planNewGroup } from "../../utils/editor/groupPlan";
import type { SubgraphNavigation } from "./useSubgraphNavigation";

/** The edits the builder makes to the groups and the steps of the open graph. */
export function useGroupEditing(ctx: EditorContext, nav: SubgraphNavigation) {
  const {
    actionTypes,
    currentGraph,
    dataNodeTypes,
    editorMode,
    inspectorRef,
    isCurrentGraphReadOnly,
    nodeKinds,
    selected,
    selectedNode,
    selectedNodeId,
    selectedNodeIds,
    subgraphPath,
    t,
    templatePorts,
    triggerTypes,
  } = ctx;
  const { onGraphUpdate, onUpdateNode } = nav;

  const schemaSources = {
    currentGraph,
    nodeKinds,
    triggerTypes,
    actionTypes,
    dataNodeTypes,
  };

  function onPortsUpdate(payload: { nodeId: string; ports: GroupPort[] }) {
    const g = currentGraph.value;
    if (!g) return;
    const idx = g.nodes.findIndex(
      (n) => n.id === payload.nodeId && n.kind === "group",
    );
    if (idx === -1) return;
    const existing = g.nodes[idx]!;
    // Template instances don't own a local subgraph — their `ports` come from
    // the template definition and are read-only on the instance. Defensive:
    // silently no-op if someone managed to invoke the editor on one.
    if (existing.templateId) return;

    // Detect renames against the PREVIOUS ports array BEFORE we replace it.
    // Pure additions and pure deletions yield no renames; syncSentinels still
    // handles deletions by dropping orphaned inner edges, and the outer graph
    // has no edges for added ports yet, so neither needs port-name rewrites.
    const oldPorts = Array.isArray(existing.ports) ? existing.ports : [];
    const renames = detectPortRenames(oldPorts, payload.ports);

    // Build a deep-cloned group node so syncSentinels can mutate its subgraph
    // freely without aliasing into the current graph's state. The outer
    // onUpdateNode/onGraphUpdate path expects a fresh node reference.
    const clonedGroup: GraphNode = {
      ...existing,
      ports: payload.ports.map((p) => ({ ...p })),
      subgraph: existing.subgraph
        ? (JSON.parse(JSON.stringify(existing.subgraph)) as ProcedureGraph)
        : undefined,
    };

    // Cascade renames into the INNER subgraph before syncSentinels runs — if
    // we waited until after, syncSentinels would treat the old port names
    // still on inner edges as references to deleted ports and drop them.
    if (renames.length > 0 && clonedGroup.subgraph) {
      const gi = clonedGroup.subgraph.nodes.find(
        (n) => n.kind === "groupInput",
      );
      const go = clonedGroup.subgraph.nodes.find(
        (n) => n.kind === "groupOutput",
      );
      // Group-level "in" ports surface as groupInput's OUT handles, and
      // group-level "out" ports surface as groupOutput's IN handles. We pass
      // invertDirection=true and target the right sentinel per direction.
      const inRenames = renames.filter((r) => r.direction === "in");
      const outRenames = renames.filter((r) => r.direction === "out");
      if (gi && inRenames.length > 0) {
        applyPortRenamesToEdges(
          clonedGroup.subgraph.triggerEdges,
          clonedGroup.subgraph.dataEdges,
          gi.id,
          inRenames,
          true,
        );
      }
      if (go && outRenames.length > 0) {
        applyPortRenamesToEdges(
          clonedGroup.subgraph.triggerEdges,
          clonedGroup.subgraph.dataEdges,
          go.id,
          outRenames,
          true,
        );
      }
    }

    syncSentinels(clonedGroup);

    // Cascade renames into the OUTER graph's edges (where this group node is
    // an endpoint). We do this by walking the current graph, cloning the
    // triggerEdges / dataEdges arrays, applying the renames, then going
    // through onGraphUpdate so history + dirty tracking pick it up. We can't
    // rely on onUpdateNode for outer-edge changes because it only replaces
    // the node, not the edges.
    if (renames.length > 0) {
      const nextOuter: ProcedureGraph = {
        ...g,
        nodes: g.nodes.map((n, i) => (i === idx ? clonedGroup : n)),
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
        nextOuter.triggerEdges,
        nextOuter.dataEdges,
        payload.nodeId,
        renames,
        false,
      );
      onGraphUpdate(nextOuter);
      return;
    }

    onUpdateNode(clonedGroup);
  }

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

  // Inspector "Delete node" button — same outcome as pressing Delete/Backspace
  // on the canvas: drop the node plus every trigger/data edge that touches it.
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

  // ---------------------------------------------------------------------------
  // Create-group-from-selection
  // ---------------------------------------------------------------------------
  // Visible when the user has selected one or more eligible nodes in the
  // current canvas. "Eligible" rules out kinds that can't legally live inside
  // a group's subgraph in v1:
  //   • `trigger` — triggers must live at the top level of a procedure.
  //   • `groupInput` / `groupOutput` — sentinels are auto-managed and only
  //     valid inside their owning group.
  // Selection containing multiple groups IS allowed: nesting an existing
  // group inside a new one is just a regular subgraph node move; the v1
  // validator doesn't forbid it, and the executor's depth cap catches
  // runaway recursion.
  //
  // Also gated on:
  //   • An editable graph (not the read-only template-instance view).
  //   • A real procedure being open (selected.value).
  const canGroupSelection = computed<boolean>(() => {
    if (!selected.value) return false;
    if (isCurrentGraphReadOnly.value) return false;
    const ids = selectedNodeIds.value;
    if (ids.length === 0) return false;
    const g = currentGraph.value;
    if (!g) return false;
    const idSet = new Set(ids);
    for (const n of g.nodes) {
      if (!idSet.has(n.id)) continue;
      if (n.kind === "trigger") return false;
      if (n.kind === "groupInput" || n.kind === "groupOutput") return false;
    }
    return true;
  });

  function createGroupFromSelection() {
    if (!canGroupSelection.value) return;
    const g = currentGraph.value;
    if (!g) return;
    const ids = selectedNodeIds.value.slice();
    if (ids.length === 0) return;

    // The group gets a default name, then the inspector opens on it with its
    // name field focused: renaming is one keystroke away, nothing blocks.
    const inputName = t("dms_automation.editor.groupDefaultName");

    const selection = new Set(ids);
    const groupId = newId();

    const plan = planNewGroup(g, selection, groupId, schemaSources);

    // Position the new group at the centroid of the selection. We also
    // shift the selected nodes' positions into the subgraph's coordinate
    // space: subtract the selection min, then add a left-margin so the
    // groupInput sentinel can sit at x ≈ 0.
    const SUBGRAPH_LEFT_MARGIN = 220; // groupInput sits at x = 0 with room
    const SUBGRAPH_RIGHT_MARGIN = 220;
    const selectedNodes = g.nodes.filter((n) => selection.has(n.id));
    const xs = selectedNodes.map((n) => n.position.x);
    const ys = selectedNodes.map((n) => n.position.y);
    const minX = xs.length ? Math.min(...xs) : 0;
    const maxX = xs.length ? Math.max(...xs) : 0;
    const minY = ys.length ? Math.min(...ys) : 0;
    const maxY = ys.length ? Math.max(...ys) : 0;
    const centerX = xs.length ? (minX + maxX) / 2 : 200;
    const centerY = ys.length ? (minY + maxY) / 2 : 200;

    const innerNodes: GraphNode[] = selectedNodes.map((n) => ({
      ...JSON.parse(JSON.stringify(n)),
      position: {
        x: n.position.x - minX + SUBGRAPH_LEFT_MARGIN,
        y: n.position.y - minY,
      },
    }));

    const innerHeight = Math.max(maxY - minY, 0);
    const innerWidth = Math.max(maxX - minX, 0);

    const groupInputNode: GraphNode = {
      id: plan.groupInputId,
      kind: "groupInput",
      config: {},
      position: { x: 0, y: innerHeight / 2 },
    };
    const groupOutputNode: GraphNode = {
      id: plan.groupOutputId,
      kind: "groupOutput",
      config: {},
      position: {
        x: innerWidth + SUBGRAPH_LEFT_MARGIN + SUBGRAPH_RIGHT_MARGIN,
        y: innerHeight / 2,
      },
    };

    // Inner edges fully inside the selection — keep them verbatim (re-id
    // not required since we keep node ids stable; ids only need to be
    // unique within their containing graph and these are all from the
    // outer graph we just stripped them from).
    const innerOriginalTriggerEdges = g.triggerEdges.filter(
      (e) => selection.has(e.from.node) && selection.has(e.to.node),
    );
    const innerOriginalDataEdges = g.dataEdges.filter(
      (e) => selection.has(e.from.node) && selection.has(e.to.node),
    );

    const newGroupNode: GraphNode = {
      id: groupId,
      kind: "group",
      config: { name: inputName },
      position: { x: centerX, y: centerY },
      ports: plan.groupPorts,
      subgraph: {
        nodes: [...innerNodes, groupInputNode, groupOutputNode],
        triggerEdges: [...innerOriginalTriggerEdges, ...plan.innerTriggerEdges],
        dataEdges: [...innerOriginalDataEdges, ...plan.innerDataEdges],
      },
    };

    // Build the new outer graph: drop the selected nodes + every edge that
    // touches them (cut OR fully-inside), then add the new group + the
    // replacement outer edges.
    const remainingOuterNodes = g.nodes.filter((n) => !selection.has(n.id));
    const remainingOuterTriggerEdges = g.triggerEdges.filter(
      (e) => !selection.has(e.from.node) && !selection.has(e.to.node),
    );
    const remainingOuterDataEdges = g.dataEdges.filter(
      (e) => !selection.has(e.from.node) && !selection.has(e.to.node),
    );

    const nextGraph: ProcedureGraph = {
      nodes: [...remainingOuterNodes, newGroupNode],
      triggerEdges: [...remainingOuterTriggerEdges, ...plan.outerTriggerEdges],
      dataEdges: [...remainingOuterDataEdges, ...plan.outerDataEdges],
    };

    // Clear stale selection — the original ids no longer exist in the
    // outer graph. Select the newly-created group.
    selectedNodeIds.value = [];
    selectedNodeId.value = groupId;

    onGraphUpdate(nextGraph);
    void focusInspectorName();
  }

  /** Focuses the inspector's first field, the step name, and selects its text. */
  async function focusInspectorName() {
    await nextTick();
    const input = inspectorRef.value?.querySelector("input");
    input?.focus();
    input?.select();
  }

  function onDuplicateNode(payload: { id: string }) {
    const g = currentGraph.value;
    if (!g || isCurrentGraphReadOnly.value) return;
    const node = g.nodes.find((n) => n.id === payload.id);
    if (!node) return;
    const copy: GraphNode = {
      ...cloneGraph({ nodes: [node], triggerEdges: [], dataEdges: [] })
        .nodes[0]!,
      id: newId(),
      position: { x: node.position.x + 40, y: node.position.y + 60 },
    };
    onGraphUpdate({ ...g, nodes: [...g.nodes, copy] });
    selectedNodeId.value = copy.id;
  }

  /** Put a Retry in front of a step: it now runs inside the Retry's body. */
  function onWrapInRetry(payload: { id: string }) {
    const g = currentGraph.value;
    if (!g || isCurrentGraphReadOnly.value) return;
    const node = g.nodes.find((n) => n.id === payload.id);
    if (!node) return;
    const retry: GraphNode = {
      id: newId(),
      kind: "retry",
      config: { maxAttempts: 3 },
      position: { x: node.position.x - 40, y: node.position.y - 140 },
    };
    const triggerEdges = g.triggerEdges.map((e) => {
      if (e.to.node === node.id)
        return { ...e, to: { ...e.to, node: retry.id } };
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
    onGraphUpdate({ ...g, nodes: [...g.nodes, retry], triggerEdges });
    selectedNodeId.value = retry.id;
  }

  // Template mode: the template's own ports are edited at its root, where its
  // Group input / Group output steps show them. Shown when no step, or
  // one of those two, is selected.
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
    // The root graph is the template's subgraph: renames and removals go
    // through the same path as a group's ports.
    const template: GraphNode = {
      id: "",
      kind: "group",
      config: {},
      position: { x: 0, y: 0 },
      ports: next.map((p) => ({ ...p })),
      subgraph: cloneGraph(root),
    };
    const renames = detectPortRenames(templatePorts.value, next);
    const gi = template.subgraph!.nodes.find((n) => n.kind === "groupInput");
    const go = template.subgraph!.nodes.find((n) => n.kind === "groupOutput");
    const inRenames = renames.filter((r) => r.direction === "in");
    const outRenames = renames.filter((r) => r.direction === "out");
    if (gi && inRenames.length > 0)
      applyPortRenamesToEdges(
        template.subgraph!.triggerEdges,
        template.subgraph!.dataEdges,
        gi.id,
        inRenames,
        true,
      );
    if (go && outRenames.length > 0)
      applyPortRenamesToEdges(
        template.subgraph!.triggerEdges,
        template.subgraph!.dataEdges,
        go.id,
        outRenames,
        true,
      );
    syncSentinels(template);
    templatePorts.value = template.ports!;
    onGraphUpdate(template.subgraph!);
  }

  return {
    onPortsUpdate,
    onUnwireField,
    onDeleteNode,
    canGroupSelection,
    createGroupFromSelection,
    focusInspectorName,
    onDuplicateNode,
    onWrapInRetry,
    showTemplatePorts,
    onTemplatePortsUpdate,
  };
}

export type GroupEditing = ReturnType<typeof useGroupEditing>;
