import type { Connection } from "@vue-flow/core";
import type { NodeRunState } from "../../../components/Editor/nodes/GenericNode.vue";
import type { NodeKindEntry } from "../../../composables/useAutomationNodeKinds";
import type {
  ActionType,
  DataNodeType,
  GroupPort,
  NodeKind,
  ProcedureGraph,
  TriggerType,
} from "../../../composables/useGraphConnect";
import type { WordedTrigger } from "../../../utils/describe";

/** The props of the graph canvas. */
export interface CanvasProps {
  graph: ProcedureGraph;
  triggerTypes: TriggerType[];
  actionTypes: ActionType[];
  dataNodeTypes: DataNodeType[];
  /**
   * Per-NodeKind metadata served by `/api/automation/node-kinds`. The
   * `ui` block on each entry tells `dataFor` how to render the node —
   * label, icon, port lists, type-registry / dynamic-config hooks. The
   * frontend has zero kind-specific code beyond group + sentinels.
   */
  nodeKinds: NodeKindEntry[];
  canUndo?: boolean;
  canRedo?: boolean;
  // When the canvas is showing a group's inner subgraph, these are the
  // parent group's declared ports — the sentinel nodes (groupInput /
  // groupOutput) render handles derived from this list rather than
  // reading from their own node data. (Sentinel nodes themselves don't
  // carry ports; their parent group does.) Undefined at the procedure
  // root.
  parentGroupPorts?: GroupPort[];
  // When true, the canvas suppresses graph mutations from user input —
  // used for the read-only view of template-instance inner subgraphs.
  // User can still pan / zoom / select / inspect, just not connect,
  // move, delete, or edit. The "Apply / Cancel" buttons are hidden too.
  readOnly?: boolean;
  /** Outcome of each node in the run shown over the canvas (a test run, a debugged run). */
  runStates?: Record<string, NodeRunState>;
  /** The problem of each node the validator named. */
  issues?: Record<string, NodeIssue>;
  /**
   * The node the editor has selected (inspector, dock "Select node", a
   * `?node=` link): the canvas selects it too and brings it into view.
   */
  selectedNodeId?: string | null;
  /**
   * Names the graph shown (the procedure, the group entered): a new key
   * fits the new graph into view.
   */
  viewKey?: string;
  /**
   * An element drawn over the canvas's right edge (the inspector on narrow
   * screens): fitting and centring keep the nodes out from under it.
   */
  coveredBy?: HTMLElement | null;
  /** The draft's triggers, worded by the server: a schedule reads in words. */
  triggers?: WordedTrigger[];
}

export interface NodeIssue {
  severity: "error" | "warning";
  message: string;
  /** Problem code, translated as `dms_automation.editor.problems.codes.<code>`. */
  code?: string;
  params?: Record<string, unknown>;
}

/** The events of the graph canvas. */
export interface CanvasEmits {
  (e: "update:graph", g: ProcedureGraph): void;
  (e: "select:node", id: string | null): void;
  // Fires whenever the selection set changes (single or multi). `ids` is
  // the full set of currently selected node ids in this canvas — used by
  // Editor.vue to drive the "Group selection" toolbar action. Sentinel
  // nodes (groupInput / groupOutput) are filtered out before emitting.
  (e: "selection-change", payload: { ids: string[] }): void;
  (e: "undo"): void;
  (e: "redo"): void;
  // Bubbles up GroupNode's @dblclick — Editor.vue uses this to push the
  // group onto the subgraph navigation path. Filtered by kind here so
  // the parent doesn't need to look the node up itself.
  (e: "group:enter", payload: { id: string }): void;
}

/** The translators the canvas gets from the host, handed to its helpers. */
export interface CanvasText {
  t: ReturnType<typeof useI18n>["t"];
  te: ReturnType<typeof useI18n>["te"];
  processI18n: ReturnType<typeof useTranslation>["processI18n"];
  processText: ReturnType<typeof useComposedText>["processText"];
}

// The node to select and bring into view once drawn: one just added, or one
// the editor points at (`readable`).
export interface Reveal {
  pending: { id: string; readable: boolean } | null;
}

// Fit view never zooms past 100% (a lone trigger would fill the canvas) and
// may go down to 10% so a large graph fits whole.
export const FIT_PADDING = 0.15;
export const FIT_MAX_ZOOM = 1;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 1.5;
// Room left around a new node, and the size assumed for a node not drawn
// yet (GenericNode's width, a typical height).
export const NODE_GAP = 60;
export const NEW_NODE_SIZE = { width: 230, height: 90 };

// Sentinel node kinds — only valid inside a group's subgraph and never
// user-deletable. We filter them out of keyboard/right-click delete in
// onNodesChange below.
export const SENTINEL_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "groupInput",
  "groupOutput",
]);

export interface XY {
  x: number;
  y: number;
}

export interface Rect extends XY {
  width: number;
  height: number;
}

export interface Port {
  /** Vue Flow handle id. */
  id: string;
  /** Port name ('' for the single trigger input of a step). */
  name: string;
}

export interface NodeHandles {
  triggerIns: Port[];
  triggerOuts: Port[];
  dataIns: Port[];
  dataOuts: Port[];
}

export interface LinkItem {
  label: string;
  connection: Connection;
}

// DmsFlowCanvas owns the VueFlow store (it calls `useVueFlow(flowId)` with a
// private id and `defineExpose`s the resulting controller). We grab that
// controller through a template ref instead of calling `useVueFlow()` here —
// a bare `useVueFlow()` would resolve to the DEFAULT store, which is NOT the
// one DmsFlowCanvas drives, so zoom/fit/updateNodeInternals would silently
// no-op. Only the handful of imperative methods we actually use are typed.
export interface FlowNodeState {
  id: string;
  selected?: boolean;
  computedPosition: XY;
  dimensions: { width: number; height: number };
}

export interface FlowController {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomTo: (zoom: number) => void;
  setViewport: (
    viewport: XY & { zoom: number },
    options?: { duration?: number },
  ) => Promise<boolean>;
  screenToFlowCoordinate: (position: XY) => XY;
  findNode: (id: string) => FlowNodeState | undefined;
  addSelectedNodes: (nodes: FlowNodeState[]) => void;
  removeSelectedNodes: (nodes: FlowNodeState[]) => void;
  updateNodeInternals: (ids?: string | string[]) => void;
  // DmsFlowCanvas `defineExpose`s the VueFlow controller; Vue's expose proxy
  // unwraps the `viewport` ref, so consumers read `.viewport.zoom` directly
  // (NOT `.viewport.value.zoom` — that extra `.value` is undefined and pinned
  // the zoom readout at 100%). Same for the refs below.
  viewport: XY & { zoom: number };
  /** Size of the canvas on screen. */
  dimensions: { width: number; height: number };
  getSelectedNodes: FlowNodeState[];
  getSelectedEdges: Array<{ id: string }>;
  /** 'invalid' while the link being drawn hovers a port that refuses it. */
  connectionStatus: "valid" | "invalid" | null;
}
