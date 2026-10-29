import type { ComputedRef, Ref } from "vue";
import { newId } from "../../../utils/automation";
import {
  PALETTE_DRAG_TYPE,
  type NodeKindUI,
  type PaletteBlock,
  type TemplateSummary,
} from "../../../composables/useAutomationNodeKinds";
import type {
  GraphNode as AppGraphNode,
  GroupPort,
  JsonSchema,
  NodeKind,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import {
  nextStepConnection,
  withConnection,
  type ConnectionCheck,
} from "./connect";
import { NEW_NODE_SIZE, NODE_GAP } from "./types";
import type {
  CanvasProps,
  FlowController,
  NodeHandles,
  Rect,
  Reveal,
  XY,
} from "./types";

function defaultsFromSchema(
  schema: JsonSchema | undefined,
): Record<string, unknown> {
  if (!schema?.properties) return {};
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (prop && prop.default !== undefined) out[name] = prop.default;
  }
  return out;
}

export function useNodePlacement({
  props,
  flowRef,
  canvasSelection,
  nodeKindUiByKind,
  emitGraph,
  reveal,
  check,
  handlesOf,
}: {
  props: Readonly<CanvasProps>;
  flowRef: Ref<FlowController | null>;
  canvasSelection: Ref<string[]>;
  nodeKindUiByKind: ComputedRef<Map<string, NodeKindUI>>;
  emitGraph: (graph: ProcedureGraph) => void;
  reveal: Reveal;
  check: ConnectionCheck;
  handlesOf: (node: AppGraphNode) => NodeHandles;
}) {
  function nodeRects(): Rect[] {
    return props.graph.nodes.map((n) => {
      const size = flowRef.value?.findNode(n.id)?.dimensions;
      return {
        ...n.position,
        width: size?.width || NEW_NODE_SIZE.width,
        height: size?.height || NEW_NODE_SIZE.height,
      };
    });
  }

  function overlaps(a: Rect, b: Rect): boolean {
    const gap = NODE_GAP / 2;
    return (
      a.x < b.x + b.width + gap &&
      b.x < a.x + a.width + gap &&
      a.y < b.y + b.height + gap &&
      b.y < a.y + a.height + gap
    );
  }

  // The first place at or below `pos` where a new node covers no other one.
  function freeSpot(pos: XY): XY {
    const rects = nodeRects();
    const spot: Rect = { ...pos, ...NEW_NODE_SIZE };
    for (
      let hit = rects.find((r) => overlaps(spot, r));
      hit;
      hit = rects.find((r) => overlaps(spot, r))
    ) {
      spot.y = hit.y + hit.height + NODE_GAP;
    }
    return { x: Math.round(spot.x), y: Math.round(spot.y) };
  }

  // A new step goes right of the selected one, else in the middle of what the
  // canvas shows.
  function newNodePosition(anchor: AppGraphNode | undefined): XY {
    const flow = flowRef.value;
    if (anchor) {
      const width =
        flow?.findNode(anchor.id)?.dimensions.width || NEW_NODE_SIZE.width;
      return freeSpot({
        x: anchor.position.x + width + NODE_GAP,
        y: anchor.position.y,
      });
    }
    if (!flow) return freeSpot({ x: 0, y: 0 });
    const { x, y, zoom } = flow.viewport;
    return freeSpot({
      x: (flow.dimensions.width / 2 - x) / zoom - NEW_NODE_SIZE.width / 2,
      y: (flow.dimensions.height / 2 - y) / zoom - NEW_NODE_SIZE.height / 2,
    });
  }

  // The node a new step follows: the one selected last on this canvas.
  function anchorNode(): AppGraphNode | undefined {
    const id =
      props.selectedNodeId ??
      canvasSelection.value[canvasSelection.value.length - 1];
    return props.graph.nodes.find((n) => n.id === id);
  }

  // Add a node where it was dropped, or next to the selected node and linked
  // from it (one undo step for both).
  function insertNode(node: AppGraphNode, at?: XY) {
    const anchor = at ? undefined : anchorNode();
    const placed = {
      ...node,
      position: at ? freeSpot(at) : newNodePosition(anchor),
    };
    const graph = { ...props.graph, nodes: [...props.graph.nodes, placed] };
    const link = anchor
      ? nextStepConnection(graph, anchor, placed, handlesOf, check)
      : null;
    emitGraph(link ? (withConnection(graph, link)?.graph ?? graph) : graph);
    reveal.pending = { id: placed.id, readable: false };
  }

  function defaultConfigFor(
    kind: NodeKind,
    typeId?: string,
  ): Record<string, unknown> {
    const ui = nodeKindUiByKind.value.get(kind);
    if (ui?.typeRegistry === "triggers") {
      const t = props.triggerTypes.find((tt) => tt.id === typeId);
      return defaultsFromSchema(t?.configSchema);
    }
    if (ui?.typeRegistry === "actions") {
      const a = props.actionTypes.find((aa) => aa.id === typeId);
      return defaultsFromSchema(a?.inputSchema);
    }
    if (ui?.typeRegistry === "dataNodes") {
      const d = props.dataNodeTypes.find((dd) => dd.id === typeId);
      // Constant nodes seed from `configSchema` (their value lives there);
      // wired-port data nodes seed any `inputSchema` field defaults.
      return {
        ...defaultsFromSchema(d?.inputSchema),
        ...defaultsFromSchema(d?.configSchema),
      };
    }
    // Static-config kinds carry their seed config in metadata; deep-clone
    // so each instance gets its own mutable copy. JSON round-trip strips
    // the Vue reactive proxy that wraps `props.nodeKinds` — structuredClone
    // would throw on the proxy.
    return ui?.defaultConfig
      ? (JSON.parse(JSON.stringify(ui.defaultConfig)) as Record<
          string,
          unknown
        >)
      : {};
  }

  function addNode(kind: NodeKind, typeId?: string, at?: XY) {
    insertNode(
      {
        id: newId(),
        kind,
        typeId,
        config: defaultConfigFor(kind, typeId),
        position: { x: 0, y: 0 },
      },
      at,
    );
  }

  // A template's `ports` are deep-cloned (JSON round-trip) onto each new
  // template-instance group node so future template edits don't retroactively
  // mutate the instance's port list (the resolved subgraph still updates live —
  // that's the live-link model).

  // Drop a template-instance group node into the current graph. The instance
  // carries `templateId` and a deep clone (JSON round-trip) of the template's
  // port list;
  // it has NO inline `subgraph` — the executor resolves the live subgraph
  // from the template cache at run time (C3.2 / C4.4). Editing the source
  // template later will retroactively change what this instance executes
  // (the "live link" model); the port list is cloned so a port rename on
  // the template doesn't silently invalidate the outer wiring on this
  // instance (the user can manually re-sync by forking + re-saving).
  function addTemplateInstance(template: TemplateSummary, at?: XY) {
    const node: AppGraphNode & {
      ports: GroupPort[];
      templateId: string;
    } = {
      id: newId(),
      kind: "group",
      config: { name: template.name },
      position: { x: 0, y: 0 },
      templateId: template._id,
      // JSON round-trip strips Vue's reactive proxy that wraps the template
      // passed from the palette; structuredClone throws on proxies.
      ports: JSON.parse(JSON.stringify(template.ports ?? [])) as GroupPort[],
    };
    insertNode(node, at);
  }

  // A block dragged from the palette lands where it is dropped.
  function onDragOver(event: DragEvent) {
    if (
      props.readOnly ||
      !event.dataTransfer?.types.includes(PALETTE_DRAG_TYPE)
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDrop(event: DragEvent) {
    const raw = event.dataTransfer?.getData(PALETTE_DRAG_TYPE);
    const flow = flowRef.value;
    if (props.readOnly || !raw || !flow) return;
    event.preventDefault();
    const point = flow.screenToFlowCoordinate({
      x: event.clientX,
      y: event.clientY,
    });
    const at = {
      x: point.x - NEW_NODE_SIZE.width / 2,
      y: point.y - NEW_NODE_SIZE.height / 2,
    };
    const block = JSON.parse(raw) as PaletteBlock;
    if (block.template) addTemplateInstance(block.template, at);
    else if (block.kind) addNode(block.kind, block.typeId, at);
  }

  return { addNode, addTemplateInstance, onDragOver, onDrop };
}
