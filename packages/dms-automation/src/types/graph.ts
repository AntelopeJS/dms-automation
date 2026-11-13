import { type DataRecord, isDataRecord, isDataValue } from "./dataValue";
import { isNumber, isPropertyBag, isString } from "./guards";

/**
 * Node kind is a free-form string keyed off the runtime kind registry.
 * The canonical list lives in `runtime/builtins/nodes/` — one file per
 * kind, each registering itself at module load. Validation against the
 * live registry happens via `nodeKindZodSchema()` in HTTP routes.
 *
 * Special cases:
 *  - `"group"` is owned by `runtime/flatten.ts` and is not in the kind
 *    registry; it's accepted by the Zod schema as an explicit literal.
 *  - `"groupInput"` / `"groupOutput"` are sentinels only valid INSIDE a
 *    group's subgraph; they are registered like any other kind but the
 *    editor manages them automatically.
 */
export type GraphNode = {
  id: string;
  kind: string;
  typeId?: string;
  config: DataRecord;
  position: { x: number; y: number };
  /** The name the builder gave the node, when it gave one. */
  label?: string;
};

/** One end of a trigger edge. `branch` is absent when the end has none. */
export type TriggerEdgeEnd = {
  node: string;
  branch?: string;
};

/** Builds an end, setting `branch` only when there is one. */
export function triggerEdgeEnd(
  node: string,
  branch: string | undefined,
): TriggerEdgeEnd {
  const end: TriggerEdgeEnd = { node };
  if (branch !== undefined) end.branch = branch;
  return end;
}

export type TriggerEdge = {
  id: string;
  from: TriggerEdgeEnd;
  /**
   * `branch` on the target carries the name of the target's trigger-in port
   * when the target is a group node or a groupOutput sentinel. It is absent
   * for ordinary target nodes, whose trigger-in is a single fixed handle.
   */
  to: TriggerEdgeEnd;
};

export type DataEdge = {
  id: string;
  from: { node: string; port: string };
  to: { node: string; field: string };
};

export type ProcedureGraph = {
  nodes: GraphNode[];
  triggerEdges: TriggerEdge[];
  dataEdges: DataEdge[];
};

export interface GroupPort {
  name: string;
  kind: "data" | "trigger";
  direction: "in" | "out";
  /**
   * The port's JSON Schema; present iff kind === "data". Kept as the builder
   * or the declaring module sent it: the module stores and serves it without
   * reading it, and a request is only checked to hold an object there.
   */
  schema?: object;
}

export interface GroupNode extends GraphNode {
  kind: "group";
  /** Present iff this is a template instance. */
  templateId?: string;
  ports: GroupPort[];
  /** Present iff local (no templateId). */
  subgraph?: ProcedureGraph;
}

export function isGroupNode(n: GraphNode): n is GroupNode {
  return n.kind === "group";
}

/** A group node that places a template: it names the template it is. */
export type TemplateInstanceNode = GroupNode & { templateId: string };

export function isTemplateInstance(n: GraphNode): n is TemplateInstanceNode {
  return isGroupNode(n) && !!n.templateId;
}

/**
 * Depth-first walk of every node in a graph, recursing into any local subgraph
 * attached to a `group` node. Template-instance group nodes (no inline
 * `subgraph`) are not recursed into — their subgraph is owned by the referenced
 * template, not this graph.
 */
export function* walkNodesRecursive(
  graph: ProcedureGraph,
): Iterable<GraphNode> {
  for (const node of graph.nodes ?? []) {
    yield node;
    if (isGroupNode(node) && node.subgraph) {
      yield* walkNodesRecursive(node.subgraph);
    }
  }
}

/** Whether `value` is an object read by name: not `null`, not an array. */
export function isFields(value: unknown): value is Record<string, unknown> {
  return isPropertyBag(value) && !Array.isArray(value);
}

function isGraphNode(value: unknown): value is GraphNode {
  if (!isFields(value)) return false;
  const { id, kind, config, position } = value;
  return (
    isString(id) &&
    isString(kind) &&
    (!Object.hasOwn(value, "typeId") || isString(value.typeId)) &&
    isDataValue(config) &&
    isDataRecord(config) &&
    isFields(position) &&
    isNumber(position.x) &&
    isNumber(position.y) &&
    (!Object.hasOwn(value, "label") || isString(value.label))
  );
}

function isTriggerEdgeEnd(value: unknown): value is TriggerEdgeEnd {
  return (
    isFields(value) &&
    isString(value.node) &&
    (!Object.hasOwn(value, "branch") || isString(value.branch))
  );
}

function isTriggerEdge(value: unknown): value is TriggerEdge {
  return (
    isFields(value) &&
    isString(value.id) &&
    isTriggerEdgeEnd(value.from) &&
    isTriggerEdgeEnd(value.to)
  );
}

function isDataEdge(value: unknown): value is DataEdge {
  if (!isFields(value)) return false;
  const { id, from, to } = value;
  return (
    isString(id) &&
    isFields(from) &&
    isString(from.node) &&
    isString(from.port) &&
    isFields(to) &&
    isString(to.node) &&
    isString(to.field)
  );
}

/** Whether `value` has the shape of a graph: its nodes and both edge lists. */
export function isProcedureGraph(value: unknown): value is ProcedureGraph {
  if (!isFields(value)) return false;
  const { nodes, triggerEdges, dataEdges } = value;
  return (
    Array.isArray(nodes) &&
    nodes.every(isGraphNode) &&
    Array.isArray(triggerEdges) &&
    triggerEdges.every(isTriggerEdge) &&
    Array.isArray(dataEdges) &&
    dataEdges.every(isDataEdge)
  );
}

/** Whether `value` has the shape of a group port. */
export function isGroupPort(value: unknown): value is GroupPort {
  if (!isFields(value)) return false;
  const { name, kind, direction } = value;
  return (
    isString(name) &&
    (kind === "data" || kind === "trigger") &&
    (direction === "in" || direction === "out") &&
    (!Object.hasOwn(value, "schema") || isPropertyBag(value.schema))
  );
}

/**
 * A graph as `JSON.stringify` stored it in a procedure or template row.
 * Throws a `SyntaxError` when the text is not JSON or not shaped as a graph.
 */
export function parseGraph(raw: string): ProcedureGraph {
  const parsed: unknown = JSON.parse(raw);
  if (!isProcedureGraph(parsed)) {
    throw new SyntaxError("not a procedure graph");
  }
  return parsed;
}
