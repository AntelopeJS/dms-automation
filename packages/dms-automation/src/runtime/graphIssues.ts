import { type ProcedureGraph, walkNodesRecursive } from "../types/graph";
import { nodeKinds } from "./nodeKinds";
import { validateGraph } from "./validate";

/** How much a problem on the graph matters: an error blocks enabling. */
export type GraphIssueSeverity = "error" | "warning";

/**
 * One problem on a graph, tied to the top-level node it concerns when the
 * validator names one, so the builder can select and mark that node.
 */
export interface GraphIssue {
  severity: GraphIssueSeverity;
  message: string;
  nodeId?: string;
}

const GROUP_PREFIX = /^group:([^ ]+) > /;
const QUOTED = /"([^"]+)"/g;

// Sentinels and data nodes are not steps: nothing has to trigger them.
const NOT_TRIGGERED_KINDS = new Set(["trigger", "data", "groupInput", "group"]);

/**
 * The top-level node a validator message is about: the group a nested message
 * is prefixed with, else the first quoted id that names a node of the graph.
 */
function nodeOfMessage(
  message: string,
  nodeIds: ReadonlySet<string>,
): string | undefined {
  const group = GROUP_PREFIX.exec(message);
  if (group?.[1] && nodeIds.has(group[1])) return group[1];
  for (const match of message.matchAll(QUOTED)) {
    const id = match[1];
    if (id && nodeIds.has(id)) return id;
  }
  const fanIn = /more than one source: (.+)::/.exec(message);
  if (fanIn?.[1] && nodeIds.has(fanIn[1])) return fanIn[1];
  return undefined;
}

function toIssue(
  severity: GraphIssueSeverity,
  message: string,
  nodeIds: ReadonlySet<string>,
): GraphIssue {
  const nodeId = nodeOfMessage(message, nodeIds);
  return nodeId ? { severity, message, nodeId } : { severity, message };
}

/**
 * Steps nothing triggers: a step without an incoming trigger edge never runs.
 * Data nodes are evaluated on demand and trigger nodes are entry points, so
 * neither is reported.
 */
function untriggeredSteps(graph: ProcedureGraph): string[] {
  const triggered = new Set(graph.triggerEdges.map((e) => e.to.node));
  return graph.nodes
    .filter((n) => !NOT_TRIGGERED_KINDS.has(n.kind))
    .filter((n) => nodeKinds.has(n.kind) && !triggered.has(n.id))
    .map((n) => n.id);
}

/**
 * Every problem of a graph: the validator's errors and warnings, plus the
 * steps nothing triggers (a warning). Messages stay in English, as the
 * validator writes them; the builder adds the node's name in front.
 */
export function graphIssues(graph: ProcedureGraph): GraphIssue[] {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const verdict = validateGraph(graph);
  const errors = verdict.ok ? [] : verdict.errors;
  const issues = [
    ...errors.map((m) => toIssue("error", m, nodeIds)),
    ...verdict.warnings.map((m) => toIssue("warning", m, nodeIds)),
  ];
  for (const nodeId of untriggeredSteps(graph)) {
    issues.push({
      severity: "warning",
      message: "nothing triggers this step, it can never run",
      nodeId,
    });
  }
  return issues;
}

/** Whether a graph has a problem that blocks enabling it. */
export function hasBlockingIssue(issues: readonly GraphIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/** Whether a graph has at least one trigger node, nested groups included. */
export function hasTrigger(graph: ProcedureGraph): boolean {
  for (const node of walkNodesRecursive(graph)) {
    if (node.kind === "trigger") return true;
  }
  return false;
}
