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
import type { GraphIssue } from "../../types/editor";

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
  /**
   * The declared ports of the parent group while the canvas shows its inner
   * subgraph: the sentinel nodes (groupInput, groupOutput) draw their handles
   * from them, as they carry no ports of their own. Undefined at the procedure
   * root.
   */
  parentGroupPorts?: GroupPort[];
  /**
   * Suppresses graph mutations from user input (the inner subgraph of a
   * template instance): the user can still pan, zoom, select and inspect.
   */
  readOnly?: boolean;
  /** Outcome of each node in the run shown over the canvas (a test run, a debugged run). */
  runStates?: Map<string, NodeRunState>;
  /** The problem of each node the validator named. */
  issues?: Map<string, NodeIssue>;
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

/**
 * The problem of a node: its `code` is translated as
 * `dms_automation.editor.problems.codes.<code>`, `message` is the fallback.
 */
export type NodeIssue = Omit<GraphIssue, "nodeId">;

/**
 * The events of the graph canvas. `selection-change` carries every selected
 * node id of the canvas, sentinels excluded. `group:enter` is the double-click
 * of a group node, filtered by kind here.
 */
export interface CanvasEmits {
  (e: "update:graph", g: ProcedureGraph): void;
  (e: "select:node", id: string | null): void;
  (e: "selection-change", payload: { ids: string[] }): void;
  (e: "undo"): void;
  (e: "redo"): void;
  (e: "group:enter", payload: { id: string }): void;
}

/** The translators the canvas gets from the host, handed to its helpers. */
export interface CanvasText {
  t: ReturnType<typeof useI18n>["t"];
  te: ReturnType<typeof useI18n>["te"];
  processI18n: ReturnType<typeof useTranslation>["processI18n"];
  processText: ReturnType<typeof useComposedText>["processText"];
}

/**
 * The node to select and bring into view once drawn: one just added, or one
 * the editor points at (`readable`).
 */
export interface Reveal {
  pending: { id: string; readable: boolean } | null;
}

export const FIT_PADDING = 0.15;

/** Fit view never zooms past 100%: a lone trigger would fill the canvas. */
export const FIT_MAX_ZOOM = 1;

/** Fit view may go down to 10% so a large graph fits whole. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 1.5;

/** Room left around a new node. */
export const NODE_GAP = 60;

/** The size assumed for a node not drawn yet: GenericNode's width, a typical height. */
export const NEW_NODE_SIZE = { width: 230, height: 90 };

/** Node kinds valid only inside a group's subgraph and never user-deletable. */
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

/** A node of the Vue Flow store, as far as the canvas reads it. */
export interface FlowNodeState {
  id: string;
  selected?: boolean;
  computedPosition: XY;
  dimensions: { width: number; height: number };
}

/**
 * The Vue Flow controller DmsFlowCanvas exposes, read through a template ref:
 * a bare `useVueFlow()` would resolve to the default store, not the private
 * one DmsFlowCanvas drives, and zoom, fit and `updateNodeInternals` would
 * silently do nothing. Vue's expose proxy unwraps the refs, so `viewport.zoom`
 * is read directly, without `.value`. Only the methods the canvas uses are typed.
 */
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
  viewport: XY & { zoom: number };
  /** Size of the canvas on screen. */
  dimensions: { width: number; height: number };
  getSelectedNodes: FlowNodeState[];
  getSelectedEdges: Array<{ id: string }>;
  /** 'invalid' while the link being drawn hovers a port that refuses it. */
  connectionStatus: "valid" | "invalid" | null;
}
