import type {
  GraphNode as AppGraphNode,
  GroupPort,
  JsonSchema,
  NodeKind,
  DataEdge,
  TriggerEdge,
} from "../../../composables/useGraphConnect";
import type { CanvasProps, NodeHandles } from "./types";
import { SENTINEL_KINDS } from "./types";

export function vfTypeFor(kind: NodeKind): string {
  if (kind === "group") return "group";
  if (kind === "groupInput") return "groupInput";
  if (kind === "groupOutput") return "groupOutput";
  return "genericNode";
}

export function propsOf(schema: JsonSchema | undefined) {
  if (!schema?.properties) return [];
  return Object.entries(schema.properties).map(([name, p]) => ({
    name,
    type: Array.isArray(p?.type) ? p?.type[0] : p?.type,
    title: p?.title,
  }));
}

// What a screen reader announces for a node: its type when the node has a
// name of its own, its name, and what it does.
export function ariaLabelOf(data: {
  label?: string;
  typeName?: string;
  summary?: string;
}) {
  if (!data.label) return undefined;
  const type =
    data.typeName && data.typeName !== data.label ? `${data.typeName}: ` : "";
  return `${type}${data.label}${data.summary ? `, ${data.summary}` : ""}`;
}

// Trigger edges into a group node or groupOutput sentinel target a specific
// trigger-in port — the port name lives on `e.to.branch`. Ordinary target
// nodes have a single fixed `trigger-in` handle.
export function triggerTargetHandle(
  e: TriggerEdge,
  targetKind: NodeKind | undefined,
): string {
  if (targetKind === "group") {
    return `group-trigger-in-${e.to.branch}`;
  }
  if (targetKind === "groupOutput") {
    // Trigger edge from an inner node into the groupOutput sentinel —
    // the sentinel exposes a `groupOutput-trigger-in-<port>` handle per
    // declared trigger-OUT port (since trigger-OUT on the OUTER group is
    // trigger-IN on the sentinel side).
    return `groupOutput-trigger-in-${e.to.branch}`;
  }
  return "trigger-in";
}

export function triggerSourceHandle(
  e: TriggerEdge,
  sourceKind: NodeKind | undefined,
): string {
  if (sourceKind === "group") {
    // Source is the OUTER group node firing into an outer downstream
    // node — the branch name IS the port name (see planNewGroup's
    // outerTriggerEdges where `from.branch = portName`).
    return `group-trigger-out-${e.from.branch ?? "main"}`;
  }
  if (sourceKind === "groupInput") {
    // Inner edge out of groupInput into an inner node — handle id is
    // `groupInput-trigger-out-<port>` and the port name lives on
    // `from.branch` (per planNewGroup's innerTriggerEdges).
    return `groupInput-trigger-out-${e.from.branch ?? "main"}`;
  }
  return `trigger-out-${e.from.branch ?? "main"}`;
}

export function dataSourceHandle(
  e: DataEdge,
  sourceKind: NodeKind | undefined,
): string {
  if (sourceKind === "group") return `group-data-out-${e.from.port}`;
  if (sourceKind === "groupInput") return `groupInput-data-out-${e.from.port}`;
  return `data-out-${e.from.port}`;
}

export function dataTargetHandle(
  e: DataEdge,
  targetKind: NodeKind | undefined,
): string {
  if (targetKind === "group") return `group-data-in-${e.to.field}`;
  if (targetKind === "groupOutput") return `groupOutput-data-in-${e.to.field}`;
  return `data-in-${e.to.field}`;
}

// After a run, the edges it took are drawn solid and the one into the failing
// step red; the others fade.
export function edgeClass(
  runs: CanvasProps["runStates"],
  from: string,
  to: string,
): string {
  if (!runs) return "edge-trigger";
  const target = runs[to]?.status;
  const taken = runs[from] && target && target !== "skipped";
  if (taken && target === "failed") return "edge-trigger edge-failed";
  return taken ? "edge-trigger edge-taken" : "edge-trigger edge-idle";
}

// The handles a node draws, named as its renderer names them (see the
// handle prefix table in useGraphConnect).
export function handlesOf(
  node: AppGraphNode,
  parentGroupPorts: GroupPort[] | undefined,
  dataFor: (node: AppGraphNode) => object,
): NodeHandles {
  if (node.kind === "group" || SENTINEL_KINDS.has(node.kind)) {
    const ports =
      node.kind === "group"
        ? ((node as AppGraphNode & { ports?: GroupPort[] }).ports ?? [])
        : (parentGroupPorts ?? []);
    const pick = (
      kind: GroupPort["kind"],
      direction: GroupPort["direction"],
      prefix: string,
    ) =>
      ports
        .filter((p) => p.kind === kind && p.direction === direction)
        .map((p) => ({ id: `${prefix}${p.name}`, name: p.name }));
    if (node.kind === "group") {
      return {
        triggerIns: pick("trigger", "in", "group-trigger-in-"),
        triggerOuts: pick("trigger", "out", "group-trigger-out-"),
        dataIns: pick("data", "in", "group-data-in-"),
        dataOuts: pick("data", "out", "group-data-out-"),
      };
    }
    // The sentinels face inwards: the group's inputs leave groupInput, its
    // outputs enter groupOutput.
    if (node.kind === "groupInput") {
      return {
        triggerIns: [],
        triggerOuts: pick("trigger", "in", "groupInput-trigger-out-"),
        dataIns: [],
        dataOuts: pick("data", "in", "groupInput-data-out-"),
      };
    }
    return {
      triggerIns: pick("trigger", "out", "groupOutput-trigger-in-"),
      triggerOuts: [],
      dataIns: pick("data", "out", "groupOutput-data-in-"),
      dataOuts: [],
    };
  }
  const data = dataFor(node) as {
    hasTriggerIn?: boolean;
    hasMainTriggerOut?: boolean;
    triggerOuts?: string[];
    dataIns?: Array<{ name: string }>;
    dataOuts?: Array<{ name: string }>;
  };
  const branches = [
    ...(data.hasMainTriggerOut === false ? [] : ["main"]),
    ...(data.triggerOuts ?? []),
  ];
  return {
    triggerIns:
      data.hasTriggerIn === false ? [] : [{ id: "trigger-in", name: "" }],
    triggerOuts: branches.map((name) => ({ id: `trigger-out-${name}`, name })),
    dataIns: (data.dataIns ?? []).map((p) => ({
      id: `data-in-${p.name}`,
      name: p.name,
    })),
    dataOuts: (data.dataOuts ?? []).map((p) => ({
      id: `data-out-${p.name}`,
      name: p.name,
    })),
  };
}
