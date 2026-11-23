import type { JsonObject } from "../utils/json";
import type {
  NodeKindEntry,
  NodeKindUI,
  PortRef,
} from "./useAutomationNodeKinds";

/**
 * Node kind is a free-form string keyed off the runtime kind registry
 * (`/api/automation/node-kinds`). The few kinds the frontend has special
 * Vue components for (`group`, `groupInput`, `groupOutput`) are still
 * compared as string literals — they're not enumerated here.
 */
export type NodeKind = string;

export interface GraphNode {
  id: string;
  kind: NodeKind;
  typeId?: string;
  /** The step's name, set in the inspector (a group's falls back to config.name). */
  label?: string;
  config: JsonObject;
  position: { x: number; y: number };
  /** Group only: present iff kind === 'group'. */
  ports?: GroupPort[];
  /** Group only. */
  templateId?: string;
  /** Group only. */
  subgraph?: ProcedureGraph;
}

export interface TriggerEdge {
  id: string;
  from: { node: string; branch?: string };
  to: {
    node: string;
    /**
     * The target's trigger-in port name when the target is a group node or a
     * groupOutput sentinel; absent for ordinary nodes, whose trigger-in is a
     * fixed single handle.
     */
    branch?: string;
  };
}

export interface DataEdge {
  id: string;
  from: { node: string; port: string };
  to: { node: string; field: string };
}

export interface ProcedureGraph {
  nodes: GraphNode[];
  triggerEdges: TriggerEdge[];
  dataEdges: DataEdge[];
}

export interface JsonSchemaProperty {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export type JsonSchema = JsonSchemaProperty;

/**
 * `module` names the AntelopeJS module that registered the type, and is set
 * only for types coming from ANOTHER module (see src/runtime/typeOrigin.ts).
 * The builder palette groups catalog entries by it, listing the unattributed
 * ones, our own built-ins, first.
 */
export interface TriggerType {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  module?: string;
  /** False when the type is switched off in the Library. */
  enabled?: boolean;
  configSchema?: JsonSchema;
  outputSchema?: JsonSchema;
}

export interface ActionType {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  module?: string;
  /** False when the type is switched off in the Library. */
  enabled?: boolean;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
}

export interface DataNodeType {
  id: string;
  category: string;
  name: string;
  description: string;
  icon: string;
  module?: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  /**
   * Editor-only config form. When set, the inspector renders it (not
   * `inputSchema`) as the node's editable fields; data-in ports still derive
   * from `inputSchema`. Used by constant nodes (value typed, not wired).
   */
  configSchema?: JsonSchema;
}

/**
 * Mirror of backend `GroupPort`, kept local so the composable does not import
 * from `src/types/graph.ts` (a server-only path).
 */
export interface GroupPort {
  name: string;
  kind: "data" | "trigger";
  direction: "in" | "out";
  schema?: JsonSchema;
}

/**
 * A group node carries the ports its subgraph exposes, as a sibling field of
 * `config`/`position` — mirrors `GroupNode` on the backend. `ports` is optional
 * here because the value crosses the API: a hand-written (imported) graph may
 * omit it.
 */
export interface GroupNode extends GraphNode {
  kind: "group";
  ports?: GroupPort[];
}

export function isGroupNode(node: GraphNode): node is GroupNode {
  return node.kind === "group";
}

type ConnectKind = "trigger" | "data";

interface ConnectionLike {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/**
 * Why a connection is refused. The canvas turns the code into a sentence
 * (`dms_automation.editor.canvas.connect.<code>`), with `params` filled in.
 */
type ConnectRefusal =
  | "invalidPorts"
  | "kindMismatch"
  | "selfLoop"
  | "cycle"
  | "typeMismatch";

export type ConnectResult =
  | { ok: true }
  | { ok: false; code: ConnectRefusal; params?: Record<string, string> };

/**
 * Optional context for `canConnect` and the schema lookups. `parentGroupPorts`
 * is the declared port list of the outer group when the canvas edits that
 * group's inner subgraph: the sentinels (`groupInput` / `groupOutput`) carry no
 * ports themselves, so their schemas are looked up against the parent group.
 * Undefined at the procedure-graph root.
 */
interface ConnectContext {
  parentGroupPorts?: GroupPort[];
}

/** The registries a node's schemas are looked up in. */
export interface TypeCatalog {
  nodeKinds: NodeKindEntry[];
  triggerTypes: TriggerType[];
  actionTypes: ActionType[];
  dataNodeTypes: DataNodeType[];
}

/**
 * The handle ids of the canvas. Ordinary nodes: `trigger-in` (one fixed
 * handle), `trigger-out-<branch>`, `data-out-<port>`, `data-in-<field>`. An
 * outer group node: `group-trigger-in-<port>`, `group-trigger-out-<port>`,
 * `group-data-in-<port>`, `group-data-out-<port>`. The sentinels inside its
 * subgraph: `groupInput-trigger-out-<port>`, `groupInput-data-out-<port>`
 * (source side), `groupOutput-trigger-in-<port>`, `groupOutput-data-in-<port>`
 * (target side). Each prefix list is ordered longest-first, so a scan returns
 * the most specific match (`group-trigger-out-` must beat `trigger-`).
 */
const TRIGGER_PREFIX = "trigger-";
const DATA_OUT_PREFIX = "data-out-";
const DATA_IN_PREFIX = "data-in-";
const TRIGGER_OUT_PREFIX = "trigger-out-";

const GROUP_DATA_OUT_PREFIX = "group-data-out-";
const GROUP_DATA_IN_PREFIX = "group-data-in-";
const GROUP_TRIGGER_OUT_PREFIX = "group-trigger-out-";
const GROUP_TRIGGER_IN_PREFIX = "group-trigger-in-";

const GROUPINPUT_DATA_OUT_PREFIX = "groupInput-data-out-";
const GROUPINPUT_TRIGGER_OUT_PREFIX = "groupInput-trigger-out-";
const GROUPOUTPUT_DATA_IN_PREFIX = "groupOutput-data-in-";
const GROUPOUTPUT_TRIGGER_IN_PREFIX = "groupOutput-trigger-in-";

const DATA_OUT_PREFIXES = [
  GROUPINPUT_DATA_OUT_PREFIX,
  GROUP_DATA_OUT_PREFIX,
  DATA_OUT_PREFIX,
] as const;
const DATA_IN_PREFIXES = [
  GROUPOUTPUT_DATA_IN_PREFIX,
  GROUP_DATA_IN_PREFIX,
  DATA_IN_PREFIX,
] as const;
const TRIGGER_OUT_PREFIXES = [
  GROUPINPUT_TRIGGER_OUT_PREFIX,
  GROUP_TRIGGER_OUT_PREFIX,
  TRIGGER_OUT_PREFIX,
] as const;
const TRIGGER_IN_PREFIXES = [
  GROUPOUTPUT_TRIGGER_IN_PREFIX,
  GROUP_TRIGGER_IN_PREFIX,
] as const;

function stripPrefix(
  handle: string | null | undefined,
  prefixes: readonly string[],
): string | null {
  if (!handle) return null;
  for (const p of prefixes) {
    if (handle.startsWith(p)) {
      const rest = handle.slice(p.length);
      return rest || null;
    }
  }
  return null;
}

export function connectionKind(
  handle: string | null | undefined,
): ConnectKind | null {
  if (!handle) return null;
  for (const p of DATA_OUT_PREFIXES) if (handle.startsWith(p)) return "data";
  for (const p of DATA_IN_PREFIXES) if (handle.startsWith(p)) return "data";
  for (const p of TRIGGER_OUT_PREFIXES)
    if (handle.startsWith(p)) return "trigger";
  for (const p of TRIGGER_IN_PREFIXES)
    if (handle.startsWith(p)) return "trigger";
  if (handle.startsWith(TRIGGER_PREFIX)) return "trigger";
  return null;
}

/**
 * The branch a trigger-out handle names, "main" for an ordinary edge without
 * a recognized prefix (`from.branch` is optional and stored as "main"
 * elsewhere).
 */
export function parseSourceBranch(
  sourceHandle: string | null | undefined,
): string {
  const branch = stripPrefix(sourceHandle, TRIGGER_OUT_PREFIXES);
  return branch ?? "main";
}

/**
 * The target port name of a parametric trigger-in handle
 * (`group-trigger-in-<port>` / `groupOutput-trigger-in-<port>`); `undefined`
 * for the fixed single `trigger-in` handle, since ordinary nodes have no
 * per-target port name.
 */
export function parseTargetBranch(
  targetHandle: string | null | undefined,
): string | undefined {
  const branch = stripPrefix(targetHandle, TRIGGER_IN_PREFIXES);
  return branch ?? undefined;
}

export function parseDataPort(
  sourceHandle: string | null | undefined,
): string | null {
  return stripPrefix(sourceHandle, DATA_OUT_PREFIXES);
}

export function parseDataField(
  targetHandle: string | null | undefined,
): string | null {
  return stripPrefix(targetHandle, DATA_IN_PREFIXES);
}

function findNode(graph: ProcedureGraph, id: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

/**
 * A schema with one property per data port of the given direction, each
 * carrying the port's declared schema verbatim, so the `schema.properties[port]`
 * lookup works alike for ordinary nodes and group/sentinel kinds.
 */
function portsToSchema(
  ports: GroupPort[] | undefined,
  direction: "in" | "out",
): JsonSchema | undefined {
  if (!Array.isArray(ports)) return undefined;
  const properties: Record<string, JsonSchemaProperty> = {};
  for (const p of ports) {
    if (p.kind !== "data") continue;
    if (p.direction !== direction) continue;
    properties[p.name] = p.schema ?? {};
  }
  return { properties };
}

function getNodePorts(node: GraphNode): GroupPort[] | undefined {
  if (!isGroupNode(node)) return undefined;
  return Array.isArray(node.ports) ? node.ports : undefined;
}

/**
 * A schema from a kind's declared static port list: each port becomes a
 * property keyed by name, its declared `type` dropping into the `type` field so
 * the `typesCompatible` check keeps working.
 */
function portsToSyntheticSchema(ports: PortRef[]): JsonSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  for (const p of ports) {
    properties[p.name] = p.type ? { type: p.type } : {};
  }
  return { properties };
}

type SchemaHint = "inputSchema" | "outputSchema" | "configSchema";

function pickTypeSchema(
  hint: SchemaHint,
  type: TriggerType | ActionType | DataNodeType | undefined,
): JsonSchema | undefined {
  if (!type) return undefined;
  if (hint === "outputSchema") return type.outputSchema;
  if (hint === "inputSchema")
    return "inputSchema" in type ? type.inputSchema : undefined;
  return "configSchema" in type ? type.configSchema : undefined;
}

function lookupTypeForRegistry(
  registry: NodeKindUI["typeRegistry"],
  typeId: string | undefined,
  catalog: TypeCatalog,
): TriggerType | ActionType | DataNodeType | undefined {
  if (!registry || !typeId) return undefined;
  if (registry === "triggers")
    return catalog.triggerTypes.find((t) => t.id === typeId);
  if (registry === "actions")
    return catalog.actionTypes.find((a) => a.id === typeId);
  return catalog.dataNodeTypes.find((d) => d.id === typeId);
}

/**
 * The schema of a registry-backed kind on one side: the selected type's schema
 * the kind's UI metadata names, else the static port list. A `trigger` node
 * with no type yet still exposes whatever static ports it declared (usually
 * none).
 */
export function schemaFromKind(
  node: GraphNode,
  catalog: TypeCatalog,
  side: "in" | "out",
): JsonSchema | undefined {
  const ui = catalog.nodeKinds.find((k) => k.kind === node.kind)?.meta.ui;
  if (!ui) return undefined;
  const hint =
    side === "in" ? ui.dataInsFromTypeSchema : ui.dataOutsFromTypeSchema;
  const staticPorts = side === "in" ? ui.staticDataIns : ui.staticDataOuts;
  if (ui.typeRegistry && hint) {
    const type = lookupTypeForRegistry(ui.typeRegistry, node.typeId, catalog);
    const schema = pickTypeSchema(hint, type);
    if (schema) return schema;
  }
  if (staticPorts.length === 0) return undefined;
  return portsToSyntheticSchema(staticPorts);
}

/**
 * `group` and `groupInput` carry their port lists out-of-band, so they bypass
 * the kind registry: the outer group stores `ports` on the node, and a
 * `groupInput` sentinel reflects the enclosing group's data-in ports.
 */
function getOutputSchema(
  node: GraphNode,
  catalog: TypeCatalog,
  context?: ConnectContext,
): JsonSchema | undefined {
  if (node.kind === "group") {
    return portsToSchema(getNodePorts(node), "out");
  }
  if (node.kind === "groupInput") {
    return portsToSchema(context?.parentGroupPorts, "in");
  }
  return schemaFromKind(node, catalog, "out");
}

function getInputSchema(
  node: GraphNode,
  catalog: TypeCatalog,
  context?: ConnectContext,
): JsonSchema | undefined {
  if (node.kind === "group") {
    return portsToSchema(getNodePorts(node), "in");
  }
  if (node.kind === "groupOutput") {
    return portsToSchema(context?.parentGroupPorts, "out");
  }
  return schemaFromKind(node, catalog, "in");
}

/**
 * Permissive: unknown or unspecified types are compatible, and so is any
 * overlap between what the source produces and what the target accepts. A JSON
 * Schema `type` may be a string or a union array.
 */
function typesCompatible(
  a: string | string[] | undefined,
  b: string | string[] | undefined,
): boolean {
  if (!a || !b) return true;
  const sa = Array.isArray(a) ? a : [a];
  const sb = Array.isArray(b) ? b : [b];
  if (sa.length === 0 || sb.length === 0) return true;
  return sa.some((t) => sb.includes(t));
}

function isTriggerSourceHandle(handle: string | null | undefined): boolean {
  if (!handle) return false;
  return TRIGGER_OUT_PREFIXES.some((p) => handle.startsWith(p));
}

function isTriggerTargetHandle(handle: string | null | undefined): boolean {
  if (!handle) return false;
  if (handle === "trigger-in") return true;
  return TRIGGER_IN_PREFIXES.some((p) => handle.startsWith(p));
}

/**
 * True when `to` can be reached from `from` by following `next`: linking `to`
 * back to `from` would then close a loop.
 */
function reaches(
  from: string,
  to: string,
  next: (node: string) => string[],
): boolean {
  const seen = new Set<string>();
  const stack = [from];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node === to) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    stack.push(...next(node));
  }
  return false;
}

/**
 * Vue Flow calls `isValidConnection` on every edge during prop sync, so an edge
 * already in the graph is a re-validation: its persisted state is trusted.
 */
function isPersistedEdge(graph: ProcedureGraph, id: string | undefined) {
  return (
    !!id &&
    (graph.triggerEdges.some((e) => e.id === id) ||
      graph.dataEdges.some((e) => e.id === id))
  );
}

/**
 * Handles of a trigger link, checked for the shape the server accepts. The
 * server refuses a trigger cycle, so it is refused while drawing: the edge
 * this one may replace leaves `source`, so it cannot be on a path that ends
 * there. Replacing an existing outgoing edge is the connect handler's job, and
 * divergence is enforced server-side by `validate.ts`.
 */
function canConnectTrigger(
  graph: ProcedureGraph,
  source: string,
  target: string,
  handles: { source?: string | null; target?: string | null },
): ConnectResult {
  if (
    !isTriggerSourceHandle(handles.source) ||
    !isTriggerTargetHandle(handles.target)
  )
    return { ok: false, code: "invalidPorts" };
  const closesLoop = reaches(target, source, (n) =>
    graph.triggerEdges.filter((e) => e.from.node === n).map((e) => e.to.node),
  );
  return closesLoop ? { ok: false, code: "cycle" } : { ok: true };
}

interface DataLink {
  sourceNode: GraphNode;
  targetNode: GraphNode;
  port: string;
  field: string;
}

/**
 * A loop of data nodes fails at run time ("data node cycle detected"). A loop
 * through a step only reads that step's last output, so it stays.
 */
function closesDataLoop(graph: ProcedureGraph, link: DataLink): boolean {
  const isData = (id: string) => findNode(graph, id)?.kind === "data";
  const { sourceNode, targetNode } = link;
  return (
    isData(sourceNode.id) &&
    isData(targetNode.id) &&
    reaches(targetNode.id, sourceNode.id, (n) =>
      graph.dataEdges
        .filter((e) => e.from.node === n && isData(e.to.node))
        .map((e) => e.to.node),
    )
  );
}

function typeText(type: string | string[] | undefined): string {
  return Array.isArray(type) ? type.join(" / ") : (type ?? "");
}

/** A data link overwrites freely: the caller replaces what it overwrites. */
function canConnectData(
  graph: ProcedureGraph,
  link: DataLink,
  catalog: TypeCatalog,
  context?: ConnectContext,
): ConnectResult {
  if (closesDataLoop(graph, link)) return { ok: false, code: "cycle" };
  const outSchema = getOutputSchema(link.sourceNode, catalog, context);
  const inSchema = getInputSchema(link.targetNode, catalog, context);
  const outProp = outSchema?.properties?.[link.port];
  const inProp = inSchema?.properties?.[link.field];
  if ((outSchema && !outProp) || (inSchema && !inProp))
    return { ok: false, code: "invalidPorts" };
  if (!typesCompatible(outProp?.type, inProp?.type))
    return {
      ok: false,
      code: "typeMismatch",
      params: { from: typeText(outProp?.type), to: typeText(inProp?.type) },
    };
  return { ok: true };
}

/**
 * Whether a connection may be drawn. A connection missing an endpoint is
 * accepted: Vue Flow may call this during prop sync before the connection is
 * populated, and rejecting it would drop the existing edge from the render.
 */
export function canConnect(
  graph: ProcedureGraph,
  catalog: TypeCatalog,
  connection: ConnectionLike,
  context?: ConnectContext,
): ConnectResult {
  const { source, target, sourceHandle, targetHandle } = connection;
  if (!source || !target) return { ok: true };
  if (isPersistedEdge(graph, connection.id)) return { ok: true };

  const fromKind = connectionKind(sourceHandle);
  const toKind = connectionKind(targetHandle);
  if (!fromKind || !toKind) return { ok: false, code: "invalidPorts" };
  if (fromKind !== toKind) return { ok: false, code: "kindMismatch" };
  if (source === target) return { ok: false, code: "selfLoop" };

  const sourceNode = findNode(graph, source);
  const targetNode = findNode(graph, target);
  if (!sourceNode || !targetNode) return { ok: false, code: "invalidPorts" };

  if (fromKind === "trigger")
    return canConnectTrigger(graph, source, target, {
      source: sourceHandle,
      target: targetHandle,
    });

  const port = parseDataPort(sourceHandle);
  const field = parseDataField(targetHandle);
  if (!port || !field) return { ok: false, code: "invalidPorts" };
  return canConnectData(
    graph,
    { sourceNode, targetNode, port, field },
    catalog,
    context,
  );
}
