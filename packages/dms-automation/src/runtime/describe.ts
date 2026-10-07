import {
  type GraphNode,
  isGroupNode,
  type ProcedureGraph,
} from "../types/graph";
import { nodeKinds } from "./nodeKinds";
import { registry } from "./registry";

/** Separator the flattener puts between a group id and an inner node id. */
const FLAT_ID_SEPARATOR = "__";

const TYPE_LOOKUP: Record<
  string,
  (id: string) => { name: string } | undefined
> = {
  trigger: (id) => registry.getTrigger(id),
  action: (id) => registry.getAction(id),
  data: (id) => registry.getDataNode(id),
};

/**
 * A step of a procedure as the UI names it: its own label when the builder
 * gave it one, else the name of its type (an i18n key when the type declares
 * one), else its kind's label.
 */
export interface StepName {
  nodeId: string;
  label?: string;
  typeName?: string;
  kind?: string;
}

/** Name of the type or kind a node runs. */
function typeNameOf(node: GraphNode): string | undefined {
  const lookup = TYPE_LOOKUP[node.kind];
  if (lookup && node.typeId) return lookup(node.typeId)?.name ?? node.typeId;
  return nodeKinds.get(node.kind)?.meta.ui?.label;
}

/** The label the builder gave a node, if any. */
export function labelOf(node: GraphNode): string | undefined {
  const label = (node as GraphNode & { label?: unknown }).label;
  return typeof label === "string" && label.trim() ? label.trim() : undefined;
}

/**
 * Resolve a node id the executor logged — flattened, so a node inside a group
 * reads `<groupId>__<innerId>` — back to the node of the stored graph. Inside
 * a template instance the inner graph is not stored, and the group itself
 * names the step.
 */
function findStep(
  graph: ProcedureGraph,
  flatId: string,
): GraphNode | undefined {
  const parts = flatId.split(FLAT_ID_SEPARATOR);
  let current: ProcedureGraph | undefined = graph;
  let found: GraphNode | undefined;
  for (const part of parts) {
    const node: GraphNode | undefined = current?.nodes.find(
      (n) => n.id === part,
    );
    if (!node) break;
    found = node;
    current = isGroupNode(node) ? node.subgraph : undefined;
  }
  return found;
}

export function stepName(graph: ProcedureGraph, flatId: string): StepName {
  const node = findStep(graph, flatId);
  if (!node) return { nodeId: flatId };
  const name: StepName = { nodeId: flatId, kind: node.kind };
  const label = labelOf(node);
  const typeName = typeNameOf(node);
  if (label) name.label = label;
  if (typeName) name.typeName = typeName;
  return name;
}

/** The text a step reads as: its label, else its type name, else its id. */
export function stepTitle(name: StepName): string {
  return name.label ?? name.typeName ?? name.nodeId;
}

/**
 * What starts a procedure, structured so the UI words it in its language: the
 * trigger type, its name, and the settings that identify it (the webhook's
 * method and path, the schedule's cron expression).
 */
export interface TriggerSummary {
  nodeId: string;
  typeId: string;
  typeName: string;
  method?: string;
  path?: string;
  cron?: string;
}

const DEFAULT_WEBHOOK_METHOD = "POST";

function configString(node: GraphNode, key: string): string | undefined {
  const value = node.config?.[key];
  return typeof value === "string" && value ? value : undefined;
}

export function summarizeTrigger(node: GraphNode): TriggerSummary {
  const typeId = node.typeId ?? "";
  const summary: TriggerSummary = {
    nodeId: node.id,
    typeId,
    typeName: typeNameOf(node) ?? typeId,
  };
  const path = configString(node, "path");
  const cron = configString(node, "cron");
  if (path) {
    summary.path = path;
    summary.method = configString(node, "method") ?? DEFAULT_WEBHOOK_METHOD;
  }
  if (cron) summary.cron = cron;
  return summary;
}

/** The triggers of a graph, in their order on the canvas. */
export function triggersOf(graph: ProcedureGraph): TriggerSummary[] {
  return graph.nodes
    .filter((n) => n.kind === "trigger" && n.typeId)
    .map(summarizeTrigger);
}

/** Parse a stored graph, or `undefined` when it does not parse. */
export function parseGraphSafe(raw: string): ProcedureGraph | undefined {
  try {
    const graph = JSON.parse(raw) as ProcedureGraph;
    return Array.isArray(graph?.nodes) ? graph : undefined;
  } catch {
    return undefined;
  }
}
