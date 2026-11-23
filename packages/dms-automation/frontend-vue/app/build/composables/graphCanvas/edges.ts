import { computed } from "vue";
import type { NodeKind } from "../../../composables/useGraphConnect";
import {
  dataSourceHandle,
  dataTargetHandle,
  edgeClass,
  triggerSourceHandle,
  triggerTargetHandle,
} from "./handles";
import type { CanvasProps } from "./types";

/**
 * The Vue Flow edges of the graph. Their styling lives in the stylesheet
 * (`.edge-trigger`, `.edge-data`) so the `.selected` highlight wins without
 * `!important`: an inline `style` on an edge defeats it.
 */
export function useCanvasEdges(
  props: Readonly<CanvasProps>,
  menuName: (id: string) => string,
) {
  const nodeKindById = computed<Map<string, NodeKind>>(() => {
    const m = new Map<string, NodeKind>();
    for (const n of props.graph.nodes) m.set(n.id, n.kind);
    return m;
  });

  const vfEdges = computed(() => {
    const kinds = nodeKindById.value;
    const triggerEdges = props.graph.triggerEdges.map((e) => ({
      id: e.id,
      source: e.from.node,
      target: e.to.node,
      sourceHandle: triggerSourceHandle(e, kinds.get(e.from.node)),
      targetHandle: triggerTargetHandle(e, kinds.get(e.to.node)),
      data: { kind: "trigger" as const },
      ariaLabel: `${menuName(e.from.node)} → ${menuName(e.to.node)}`,
      class: edgeClass(props.runStates, e.from.node, e.to.node),
    }));
    const dataEdges = props.graph.dataEdges.map((e) => ({
      id: e.id,
      source: e.from.node,
      target: e.to.node,
      sourceHandle: dataSourceHandle(e, kinds.get(e.from.node)),
      targetHandle: dataTargetHandle(e, kinds.get(e.to.node)),
      data: { kind: "data" as const },
      ariaLabel: `${menuName(e.from.node)} · ${e.from.port} → ${menuName(e.to.node)} · ${e.to.field}`,
      class: "edge-data",
    }));
    return [...triggerEdges, ...dataEdges];
  });

  return vfEdges;
}
