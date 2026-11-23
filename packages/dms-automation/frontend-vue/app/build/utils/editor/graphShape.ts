import type {
  GraphNode,
  GroupPort,
  JsonSchema,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import {
  cloneJsonObject,
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from "../../../utils/json";

function cloneUnknown<Value>(value: Value): Value | JsonValue {
  return isJsonValue(value) ? cloneJsonValue(value) : value;
}

function cloneSchema(schema: JsonSchema): JsonSchema {
  const copy: JsonSchema = { ...schema };
  if (Array.isArray(schema.type)) copy.type = [...schema.type];
  if (schema.enum) copy.enum = schema.enum.map(cloneUnknown);
  if (schema.default !== undefined) copy.default = cloneUnknown(schema.default);
  if (schema.properties)
    copy.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, property]) => [
        name,
        cloneSchema(property),
      ]),
    );
  if (schema.required) copy.required = [...schema.required];
  return copy;
}

function clonePort(port: GroupPort): GroupPort {
  const copy: GroupPort = { ...port };
  if (port.schema) copy.schema = cloneSchema(port.schema);
  return copy;
}

function cloneNode(node: GraphNode): GraphNode {
  const copy: GraphNode = {
    ...node,
    config: cloneJsonObject(node.config),
    position: { ...node.position },
  };
  if (node.ports) copy.ports = node.ports.map(clonePort);
  if (node.subgraph) copy.subgraph = cloneGraph(node.subgraph);
  return copy;
}

export function cloneGraph(g: ProcedureGraph): ProcedureGraph {
  return {
    nodes: g.nodes.map(cloneNode),
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
}

/** The graph as a string without per-node position: a drag is told apart from a structural change. */
export function structuralKey(g: ProcedureGraph): string {
  return JSON.stringify({
    nodes: g.nodes.map(({ position: _pos, ...rest }) => rest),
    triggerEdges: g.triggerEdges,
    dataEdges: g.dataEdges,
  });
}

function changedKeys(
  before: ReadonlyMap<string, unknown>,
  after: ReadonlyMap<string, unknown>,
): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter(
    (key) => JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key)),
  );
}

/** What an edit of one node does, when a burst of them repeats it; null for any other. */
function editedKey(a: GraphNode, b: GraphNode, keys: string[]): string | null {
  if (keys.length === 1 && keys[0] === "subgraph" && a.subgraph && b.subgraph) {
    const inner = repeatableChangeKey(a.subgraph, b.subgraph);
    return inner ? `${a.id}/${inner}` : null;
  }
  if (!keys.every((k) => k === "config" || k === "label")) return null;
  const fields = changedKeys(
    new Map<string, unknown>(Object.entries(a.config ?? {})),
    new Map<string, unknown>(Object.entries(b.config ?? {})),
  );
  return `${a.id}:${[...fields, ...(keys.includes("label") ? ["label"] : [])].join(",")}`;
}

/**
 * What a change does, when it is one a burst of changes repeats: the same
 * nodes moved ("move:a,b"), or the same settings of one node edited
 * ("edit:a:url"), at any depth of groups. `null` for anything else.
 */
export function repeatableChangeKey(
  before: ProcedureGraph,
  after: ProcedureGraph,
): string | null {
  if (
    JSON.stringify([before.triggerEdges, before.dataEdges]) !==
    JSON.stringify([after.triggerEdges, after.dataEdges])
  )
    return null;
  if (before.nodes.length !== after.nodes.length) return null;
  const moved: string[] = [];
  let edited: string | null = null;
  for (const [i, a] of before.nodes.entries()) {
    const b = after.nodes[i];
    if (!b || a.id !== b.id) return null;
    const keys = changedKeys(
      new Map<string, unknown>(Object.entries(a)),
      new Map<string, unknown>(Object.entries(b)),
    );
    if (keys.length === 0) continue;
    if (keys.length === 1 && keys[0] === "position") {
      moved.push(a.id);
      continue;
    }
    if (edited) return null;
    edited = editedKey(a, b, keys);
    if (!edited) return null;
  }
  if (edited) return moved.length ? null : `edit:${edited}`;
  return moved.length ? `move:${moved.join(",")}` : null;
}
