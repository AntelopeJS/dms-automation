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
  JsonSchema,
  NodeKind,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import {
  nextStepConnection,
  withConnection,
  type ConnectionCheck,
} from "./connect";
import {
  cloneJsonObject,
  isAbsentOr,
  isJsonValue,
  isRecord,
  isString,
} from "../../../utils/json";
import { isGroupPort } from "../editor/valueGuards";
import { clonePort } from "../../utils/editor/graphShape";
import { NEW_NODE_SIZE, NODE_GAP } from "./types";
import type {
  CanvasProps,
  FlowController,
  NodeHandles,
  Rect,
  Reveal,
  XY,
} from "./types";

type NodeConfig = AppGraphNode["config"];

function isTemplateSummary(value: unknown): value is TemplateSummary {
  return (
    isRecord(value) &&
    isString(value._id) &&
    isString(value.name) &&
    isAbsentOr(value.icon, isString) &&
    Array.isArray(value.ports) &&
    value.ports.every(isGroupPort)
  );
}

function isPaletteBlock(value: unknown): value is PaletteBlock {
  return (
    isRecord(value) &&
    isAbsentOr(value.kind, isString) &&
    isAbsentOr(value.typeId, isString) &&
    isAbsentOr(value.template, isTemplateSummary)
  );
}

function defaultsFromSchema(schema: JsonSchema | undefined): NodeConfig {
  if (!schema?.properties) return {};
  const out: NodeConfig = {};
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (isJsonValue(prop?.default)) out[name] = prop.default;
  }
  return out;
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

/** The first place at or below `pos` where a new node covers none of `rects`. */
function freeSpotAmong(rects: Rect[], pos: XY): XY {
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

function nodeRects(nodes: AppGraphNode[], flow: FlowController | null): Rect[] {
  return nodes.map((n) => {
    const size = flow?.findNode(n.id)?.dimensions;
    return {
      ...n.position,
      width: size?.width || NEW_NODE_SIZE.width,
      height: size?.height || NEW_NODE_SIZE.height,
    };
  });
}

function templateInstanceNode(template: TemplateSummary): AppGraphNode {
  return {
    id: newId(),
    kind: "group",
    config: { name: template.name },
    position: { x: 0, y: 0 },
    templateId: template._id,
    ports: (template.ports ?? []).map(clonePort),
  };
}

/**
 * The config a new node of `kind` starts from. Constant data nodes seed from
 * `configSchema` (their value lives there), wired-port data nodes also seed
 * the defaults of `inputSchema`. A static config is deep-cloned so each instance
 * gets its own copy, read through the Vue reactive proxy of `props.nodeKinds`,
 * on which `structuredClone` throws.
 */
function defaultConfigFor(
  props: Readonly<CanvasProps>,
  ui: NodeKindUI | undefined,
  typeId?: string,
): NodeConfig {
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
    return {
      ...defaultsFromSchema(d?.inputSchema),
      ...defaultsFromSchema(d?.configSchema),
    };
  }
  return ui?.defaultConfig ? cloneJsonObject(ui.defaultConfig) : {};
}

/**
 * Adds nodes to the graph. A new step goes right of the one selected last on
 * the canvas and is linked from it (one undo step for both), else in the middle
 * of what the canvas shows; a block dropped from the palette lands where it is
 * dropped.
 *
 * A template instance is a group node carrying the `templateId` and a copy of
 * the template's ports, copied through the palette's reactive proxy, on which
 * `structuredClone` throws. It has no inline `subgraph`: the executor resolves
 * the live one from the template cache, so editing the template changes what
 * the instance executes, while a port rename on the template does not
 * invalidate the instance's outer wiring.
 */
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
  function freeSpot(pos: XY): XY {
    return freeSpotAmong(nodeRects(props.graph.nodes, flowRef.value), pos);
  }

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

  function anchorNode(): AppGraphNode | undefined {
    const id =
      props.selectedNodeId ??
      canvasSelection.value[canvasSelection.value.length - 1];
    return props.graph.nodes.find((n) => n.id === id);
  }

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

  function addNode(kind: NodeKind, typeId?: string, at?: XY) {
    insertNode(
      {
        id: newId(),
        kind,
        typeId,
        config: defaultConfigFor(
          props,
          nodeKindUiByKind.value.get(kind),
          typeId,
        ),
        position: { x: 0, y: 0 },
      },
      at,
    );
  }

  function addTemplateInstance(template: TemplateSummary, at?: XY) {
    insertNode(templateInstanceNode(template), at);
  }

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
    const block: unknown = JSON.parse(raw);
    if (!isPaletteBlock(block)) return;
    if (block.template) addTemplateInstance(block.template, at);
    else if (block.kind) addNode(block.kind, block.typeId, at);
  }

  return { addNode, addTemplateInstance, onDragOver, onDrop };
}
