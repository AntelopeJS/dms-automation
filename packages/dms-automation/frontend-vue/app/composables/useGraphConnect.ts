import type { NodeKindEntry } from "./useAutomationNodeKinds";

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
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface TriggerEdge {
  id: string;
  from: { node: string; branch?: string };
  // `to.branch` carries the target's trigger-in port name when the target is
  // a group node or groupOutput sentinel. Absent for ordinary nodes whose
  // trigger-in is a fixed single handle.
  to: { node: string; branch?: string };
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
  [key: string]: unknown;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

// `module` names the AntelopeJS module that registered the type, and is set
// only for types coming from ANOTHER module (see src/runtime/typeOrigin.ts).
// The builder palette groups catalog entries by it, listing the unattributed
// ones — our own built-ins — first.
export interface TriggerType {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  module?: string;
  configSchema?: JsonSchema;
  outputSchema?: JsonSchema;
}

export interface ActionType {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  module?: string;
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
  // Optional editor-only config form. When set, the inspector renders this
  // (not `inputSchema`) as the node's editable fields; data-in ports still
  // derive from `inputSchema`. Used by constant nodes (value typed, not wired).
  configSchema?: JsonSchema;
}

// Mirror of backend `GroupPort`. Local copy so the composable doesn't import
// from `src/types/graph.ts` (server-only path).
export interface GroupPort {
  name: string;
  kind: "data" | "trigger";
  direction: "in" | "out";
  schema?: JsonSchema;
}

/**
 * A group node carries the ports its subgraph exposes, as a sibling field of
 * `config`/`position` — mirrors `GroupNode` on the backend. `ports` is optional
 * here because the value crosses the API: a group saved before it had any port,
 * or a hand-written graph, simply omits it.
 */
export interface GroupNode extends GraphNode {
  kind: "group";
  ports?: GroupPort[];
}

export function isGroupNode(node: GraphNode): node is GroupNode {
  return node.kind === "group";
}

export type ConnectKind = "trigger" | "data";

export interface ConnectionLike {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export type ConnectResult = { ok: true } | { ok: false; reason: string };

// Optional context for canConnect / schema lookups. `parentGroupPorts` is the
// declared port list of the outer group when the canvas is editing that
// group's inner subgraph — the sentinel nodes (`groupInput` / `groupOutput`)
// don't carry ports themselves, so their schemas must be looked up against
// the parent group. Undefined at the procedure-graph root.
export interface ConnectContext {
  parentGroupPorts?: GroupPort[];
}

// --- handle prefix table ---------------------------------------------------
//
// Ordinary nodes:
//   trigger-in                              (single fixed handle id)
//   trigger-out-<branch>
//   data-out-<port>  / data-in-<field>
//
// Outer group node (kind === "group"):
//   group-trigger-in-<port>  / group-trigger-out-<port>
//   group-data-in-<port>     / group-data-out-<port>
//
// Sentinels inside a group's subgraph:
//   groupInput-trigger-out-<port>           (source side)
//   groupInput-data-out-<port>              (source side)
//   groupOutput-trigger-in-<port>           (target side)
//   groupOutput-data-in-<port>              (target side)
//
// Ordered longest-first so a prefix scan returns the most specific match.
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

// Match longest-first — `group-trigger-out-` must beat `trigger-`.
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
  // Data first — `group-data-*` / `groupInput-data-*` / `groupOutput-data-*`
  // would otherwise be ambiguous with the unrelated `trigger-` prefix only by
  // length, but they don't share a leading token. Safe either way.
  for (const p of DATA_OUT_PREFIXES) if (handle.startsWith(p)) return "data";
  for (const p of DATA_IN_PREFIXES) if (handle.startsWith(p)) return "data";
  for (const p of TRIGGER_OUT_PREFIXES)
    if (handle.startsWith(p)) return "trigger";
  for (const p of TRIGGER_IN_PREFIXES)
    if (handle.startsWith(p)) return "trigger";
  // Ordinary `trigger-in` / `trigger-out-…` fall through to this guard.
  if (handle.startsWith(TRIGGER_PREFIX)) return "trigger";
  return null;
}

export function parseSourceBranch(
  sourceHandle: string | null | undefined,
): string {
  // Any of the trigger-out flavors yields a branch name. Ordinary edges
  // without a recognized prefix default to "main" (`from.branch` is optional
  // and stored as "main" elsewhere).
  const branch = stripPrefix(sourceHandle, TRIGGER_OUT_PREFIXES);
  return branch ?? "main";
}

// Pull the target port name out of a parametric trigger-in handle
// (`group-trigger-in-<port>` / `groupOutput-trigger-in-<port>`). Returns
// `undefined` for the fixed single `trigger-in` handle since ordinary
// nodes have no per-target port name.
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

// Build a JsonSchema synthesizing one property per port. Each property carries
// the port's declared schema verbatim — this lets the standard
// `schema.properties[port]` lookup work uniformly for ordinary nodes and
// group/sentinel kinds.
function portsToSchema(
  ports: GroupPort[] | undefined,
  direction: "in" | "out",
): JsonSchema | undefined {
  if (!Array.isArray(ports)) return undefined;
  const properties: Record<string, JsonSchemaProperty> = {};
  for (const p of ports) {
    if (p.kind !== "data") continue;
    if (p.direction !== direction) continue;
    properties[p.name] = (p.schema as JsonSchemaProperty | undefined) ?? {};
  }
  return { properties };
}

// `group` nodes carry `ports` directly on the node.
function getNodePorts(node: GraphNode): GroupPort[] | undefined {
  if (!isGroupNode(node)) return undefined;
  return Array.isArray(node.ports) ? node.ports : undefined;
}

// Synthesize a JsonSchema from a kind's declared static port list. Each
// port becomes a property keyed by name; its declared `type`, if any,
// drops straight into the `type` field so the existing
// `typesCompatible(outProp.type, inProp.type)` check keeps working.
function portsToSyntheticSchema(ports: PortRef[]): JsonSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  for (const p of ports) {
    properties[p.name] = p.type ? { type: p.type } : {};
  }
  return { properties };
}

interface PortRef {
  name: string;
  type?: string;
}

// Type-registry schemas have a small set of source schemas
// (`inputSchema`, `outputSchema`, `configSchema`); the per-kind UI
// metadata picks one via the `dataInsFromTypeSchema`/`dataOutsFromTypeSchema`
// hints.
function pickTypeSchema(
  hint: "inputSchema" | "outputSchema" | "configSchema" | undefined,
  type: TriggerType | ActionType | DataNodeType | undefined,
): JsonSchema | undefined {
  if (!hint || !type) return undefined;
  const t = type as TriggerType & ActionType & Partial<DataNodeType>;
  if (hint === "inputSchema") return t.inputSchema;
  if (hint === "outputSchema") return t.outputSchema;
  return t.configSchema;
}

function lookupTypeForRegistry(
  registry: "triggers" | "actions" | "dataNodes" | undefined,
  typeId: string | undefined,
  triggerTypes: TriggerType[],
  actionTypes: ActionType[],
  dataNodeTypes: DataNodeType[],
): TriggerType | ActionType | DataNodeType | undefined {
  if (!registry || !typeId) return undefined;
  if (registry === "triggers") return triggerTypes.find((t) => t.id === typeId);
  if (registry === "actions") return actionTypes.find((a) => a.id === typeId);
  return dataNodeTypes.find((d) => d.id === typeId);
}

function getOutputSchema(
  node: GraphNode,
  nodeKinds: NodeKindEntry[],
  triggerTypes: TriggerType[],
  actionTypes: ActionType[],
  dataNodeTypes: DataNodeType[],
  context?: ConnectContext,
): JsonSchema | undefined {
  // `group`/`groupInput` carry their port lists out-of-band: the outer
  // group node stores `ports` directly, and `groupInput` sentinels reflect
  // the enclosing group's data-in ports. Neither resolves through the `ui`
  // lookup below (`group` isn't in the kind registry at all; `groupInput`
  // registers without a `ui` block), so they need their own branches.
  if (node.kind === "group") {
    return portsToSchema(getNodePorts(node), "out");
  }
  if (node.kind === "groupInput") {
    return portsToSchema(context?.parentGroupPorts, "in");
  }

  const ui = nodeKinds.find((k) => k.kind === node.kind)?.meta.ui;
  if (!ui) return undefined;

  // Type-registry-backed kinds pull their data-out shape from the
  // selected type's schema. Falling back to the static port list is
  // intentional — a `trigger` node with no type yet still exposes
  // whatever staticDataOuts it declared (usually none).
  if (ui.typeRegistry && ui.dataOutsFromTypeSchema) {
    const type = lookupTypeForRegistry(
      ui.typeRegistry,
      node.typeId,
      triggerTypes,
      actionTypes,
      dataNodeTypes,
    );
    const schema = pickTypeSchema(ui.dataOutsFromTypeSchema, type);
    if (schema) return schema;
  }

  if (ui.staticDataOuts.length === 0) return undefined;
  return portsToSyntheticSchema(ui.staticDataOuts);
}

function getInputSchema(
  node: GraphNode,
  nodeKinds: NodeKindEntry[],
  triggerTypes: TriggerType[],
  actionTypes: ActionType[],
  dataNodeTypes: DataNodeType[],
  context?: ConnectContext,
): JsonSchema | undefined {
  if (node.kind === "group") {
    return portsToSchema(getNodePorts(node), "in");
  }
  if (node.kind === "groupOutput") {
    return portsToSchema(context?.parentGroupPorts, "out");
  }

  const ui = nodeKinds.find((k) => k.kind === node.kind)?.meta.ui;
  if (!ui) return undefined;

  if (ui.typeRegistry && ui.dataInsFromTypeSchema) {
    const type = lookupTypeForRegistry(
      ui.typeRegistry,
      node.typeId,
      triggerTypes,
      actionTypes,
      dataNodeTypes,
    );
    const schema = pickTypeSchema(ui.dataInsFromTypeSchema, type);
    if (schema) return schema;
  }

  if (ui.staticDataIns.length === 0) return undefined;
  return portsToSyntheticSchema(ui.staticDataIns);
}

function typesCompatible(
  a: string | string[] | undefined,
  b: string | string[] | undefined,
): boolean {
  // Treat unknown / unspecified types as compatible.
  if (!a || !b) return true;
  const sa = Array.isArray(a) ? a : [a];
  const sb = Array.isArray(b) ? b : [b];
  if (sa.length === 0 || sb.length === 0) return true;
  // Permissive: connect if there is any overlap between what the source can
  // produce and what the target accepts. JSON Schema `type` may be a string
  // or an array of strings (union).
  return sa.some((t) => sb.includes(t));
}

// A trigger source handle is any of the recognized trigger-out flavors.
function isTriggerSourceHandle(handle: string | null | undefined): boolean {
  if (!handle) return false;
  return TRIGGER_OUT_PREFIXES.some((p) => handle.startsWith(p));
}

// A trigger target handle is either the fixed single `trigger-in` (ordinary
// nodes) or one of the parametric `group-trigger-in-<port>` /
// `groupOutput-trigger-in-<port>` flavors.
function isTriggerTargetHandle(handle: string | null | undefined): boolean {
  if (!handle) return false;
  if (handle === "trigger-in") return true;
  return TRIGGER_IN_PREFIXES.some((p) => handle.startsWith(p));
}

export function canConnect(
  graph: ProcedureGraph,
  nodeKinds: NodeKindEntry[],
  triggerTypes: TriggerType[],
  actionTypes: ActionType[],
  dataNodeTypes: DataNodeType[],
  connection: ConnectionLike,
  context?: ConnectContext,
): ConnectResult {
  const { source, target, sourceHandle, targetHandle } = connection;

  // Defensive: Vue Flow may invoke `isValidConnection` during prop sync
  // before the connection is fully populated. Don't reject these — return
  // `ok` so the existing edge keeps rendering. The real connect path
  // always supplies both endpoints.
  if (!source || !target) return { ok: true };
  if (source === target) return { ok: true };

  const fromKind = connectionKind(sourceHandle);
  const toKind = connectionKind(targetHandle);
  if (!fromKind || !toKind) return { ok: false, reason: "Unrecognized handle" };
  if (fromKind !== toKind)
    return {
      ok: false,
      reason: "Cannot connect trigger handle to data handle",
    };

  const sourceNode = findNode(graph, source);
  const targetNode = findNode(graph, target);
  if (!sourceNode || !targetNode)
    return { ok: false, reason: "Unknown node id" };

  const selfId = connection.id;
  // If the edge being validated is already in the graph (Vue Flow calls
  // isValidConnection on every edge during prop sync / setEdges), it's a
  // re-validation — trust the persisted state and skip stateful checks.
  const isReValidation =
    !!selfId &&
    (graph.triggerEdges.some((e) => e.id === selfId) ||
      graph.dataEdges.some((e) => e.id === selfId));

  if (fromKind === "trigger") {
    // Source must be one of the trigger-out flavors; target one of the
    // trigger-in flavors. (No literal-handle check — the new prefixes
    // `group-trigger-in-<port>` / `groupOutput-trigger-in-<port>` are
    // valid in addition to the fixed `trigger-in`.)
    if (!isTriggerSourceHandle(sourceHandle))
      return { ok: false, reason: "Trigger source must be an out handle" };
    if (!isTriggerTargetHandle(targetHandle))
      return {
        ok: false,
        reason: "Trigger target must be a trigger-in handle",
      };
    // Stateful rules (divergence, duplicate) only apply to NEW connections.
    // During re-validation of stored edges, trust the persisted state.
    // Replacement of an existing outgoing edge is handled by the connect
    // handler, not by rejection here.
    //
    // Note: divergence is enforced server-side by `validate.ts` via
    // `nodeKinds.mayDiverge(kind)`. The frontend connect path replaces
    // existing outgoing edges per source/branch in GraphCanvas.vue so
    // divergence never actually occurs from non-whitelisted sources at
    // the editor level.
    return { ok: true };
  }

  // data edge — overwrite is allowed; replacement is handled by the caller.
  const port = parseDataPort(sourceHandle);
  const field = parseDataField(targetHandle);
  if (!port || !field) return { ok: false, reason: "Invalid data handle id" };

  if (isReValidation) return { ok: true };

  const outSchema = getOutputSchema(
    sourceNode,
    nodeKinds,
    triggerTypes,
    actionTypes,
    dataNodeTypes,
    context,
  );
  const inSchema = getInputSchema(
    targetNode,
    nodeKinds,
    triggerTypes,
    actionTypes,
    dataNodeTypes,
    context,
  );
  const outProp = outSchema?.properties?.[port];
  const inProp = inSchema?.properties?.[field];
  if (outSchema && !outProp)
    return { ok: false, reason: `Unknown source port "${port}"` };
  if (inSchema && !inProp)
    return { ok: false, reason: `Unknown target field "${field}"` };

  if (!typesCompatible(outProp?.type, inProp?.type))
    return {
      ok: false,
      reason: `Type mismatch: ${outProp?.type} → ${inProp?.type}`,
    };

  return { ok: true };
}
