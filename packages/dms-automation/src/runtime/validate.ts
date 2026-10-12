import {
  type GraphNode,
  type GroupNode,
  isGroupNode,
  type ProcedureGraph,
} from "../types/graph";
import { nodeKinds } from "./nodeKinds";
import { cycleMembers, kahn } from "./topo";

/**
 * Validation outcome. `errors` are hard blockers — the executor refuses to
 * run and HTTP routes return 400. `warnings` are surface-level advisories
 * (e.g. a group declares a data-out port but no inner edge wires it) —
 * they round-trip with the response so the client can render a warning
 * list but never block the save / run.
 */
export type ValidateResult =
  | { ok: true; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

/** Values a problem's message is built from, for the UI to word it. */
export type ProblemParams = Record<string, string | number>;

/**
 * One finding of the validator: a stable `code` the UI translates with its
 * `params`, the English `message` the executor logs, and the node of this
 * graph it is about. A finding inside a group is reported on the group.
 */
export interface GraphProblem {
  severity: "error" | "warning";
  code: string;
  params: ProblemParams;
  message: string;
  nodeId?: string;
}

/** A problem in the settings of one node, before it is tied to the node. */
export type ConfigProblem = Pick<GraphProblem, "code" | "params" | "message">;

/**
 * How deep local groups may nest. Deeper graphs are refused before they are
 * walked, so neither the schema nor this validator can overflow the stack.
 */
export const MAX_GROUP_DEPTH = 20;

class Problems {
  readonly list: GraphProblem[] = [];

  error(code: string, params: ProblemParams, message: string, nodeId?: string) {
    this.add("error", code, params, message, nodeId);
  }

  warning(
    code: string,
    params: ProblemParams,
    message: string,
    nodeId?: string,
  ) {
    this.add("warning", code, params, message, nodeId);
  }

  get hasError(): boolean {
    return this.list.some((p) => p.severity === "error");
  }

  private add(
    severity: GraphProblem["severity"],
    code: string,
    params: ProblemParams,
    message: string,
    nodeId: string | undefined,
  ) {
    const problem: GraphProblem = { severity, code, params, message };
    if (nodeId !== undefined) problem.nodeId = nodeId;
    this.list.push(problem);
  }
}

const quotedList = (ids: readonly string[]) =>
  ids.map((id) => `"${id}"`).join(", ");

// Divergence (>1 outgoing trigger edge) and per-source branch labels are
// derived from the kind registry — the source of truth is each kind's
// declared port shape, not a hand-maintained list. `group` isn't in the
// registry (it's handled by `flatten.ts`), and `groupInput` registers with
// no ports so `mayDiverge` returns false for it even though its outgoing
// edges are one-per-declared-port and managed by the editor — both are
// therefore allowed unconditionally below.

// Two nodes sharing an id: edges cannot tell them apart and the executor
// keeps only the last one.
function checkDuplicateNodeIds(graph: ProcedureGraph, problems: Problems) {
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const n of graph.nodes) {
    if (seen.has(n.id) && !reported.has(n.id)) {
      reported.add(n.id);
      problems.error(
        "duplicateNodeId",
        { node: n.id },
        `two nodes share the id "${n.id}"`,
        n.id,
      );
    }
    seen.add(n.id);
  }
}

function checkUnknownNodeRefs(
  graph: ProcedureGraph,
  nodeById: Map<string, GraphNode>,
  problems: Problems,
): void {
  const edges = [
    ...graph.triggerEdges.map((e) => ({ kind: "trigger", e })),
    ...graph.dataEdges.map((e) => ({ kind: "data", e })),
  ];
  for (const { kind, e } of edges) {
    if (!nodeById.has(e.from.node)) {
      problems.error(
        "edgeUnknownSource",
        { edge: e.id, node: e.from.node },
        `${kind} edge ${e.id}: unknown source node "${e.from.node}"`,
        nodeById.has(e.to.node) ? e.to.node : undefined,
      );
    }
    if (!nodeById.has(e.to.node)) {
      problems.error(
        "edgeUnknownTarget",
        { edge: e.id, node: e.to.node },
        `${kind} edge ${e.id}: unknown target node "${e.to.node}"`,
        nodeById.has(e.from.node) ? e.from.node : undefined,
      );
    }
  }
}

function checkTriggerDivergence(
  graph: ProcedureGraph,
  nodeById: Map<string, GraphNode>,
  problems: Problems,
): void {
  const outgoingBySource = new Map<string, number>();
  for (const e of graph.triggerEdges) {
    outgoingBySource.set(
      e.from.node,
      (outgoingBySource.get(e.from.node) ?? 0) + 1,
    );
  }
  for (const [sourceId, count] of outgoingBySource) {
    if (count < 2) continue;
    const src = nodeById.get(sourceId);
    if (!src) continue; // already reported as unknown
    // Trigger-kind nodes are entry points and may legitimately fan out into
    // parallel paths; if/switch are branching nodes; groupInput emits one edge
    // per declared trigger-in port; group nodes delegate fan-out to their
    // declared trigger-out ports.
    const allowedByRegistry = nodeKinds.mayDiverge(src.kind);
    const allowedByGroup = src.kind === "group" || src.kind === "groupInput";
    if (!allowedByRegistry && !allowedByGroup) {
      problems.error(
        "triggerDiverges",
        { node: sourceId, count },
        `trigger source cannot diverge: node "${sourceId}" (${src.kind}) has ${count} outgoing trigger edges`,
        sourceId,
      );
    }
  }
  const ifBranches = new Set(nodeKinds.metaOf("if")?.sidePorts ?? []);
  for (const e of graph.triggerEdges) {
    const src = nodeById.get(e.from.node);
    if (!src) continue;
    if (src.kind === "if" && e.from.branch !== undefined) {
      if (!ifBranches.has(e.from.branch)) {
        problems.error(
          "ifBranchInvalid",
          { edge: e.id, branch: e.from.branch },
          `trigger edge ${e.id}: if-branch must be one of ${[...ifBranches].map((b) => `"${b}"`).join(" / ")} (got "${e.from.branch}")`,
          src.id,
        );
      }
    }
  }
}

// Trigger nodes are entry points: the run seeds their output and fires their
// continuation. A trigger node with an incoming trigger edge can never run
// (its `execute` throws), so reject it here with a clear message.
function checkTriggerNodesAreEntryPoints(
  graph: ProcedureGraph,
  nodeById: Map<string, GraphNode>,
  problems: Problems,
): void {
  for (const e of graph.triggerEdges) {
    const target = nodeById.get(e.to.node);
    if (target?.kind !== "trigger") continue;
    problems.error(
      "triggerTargeted",
      { edge: e.id, node: target.id },
      `trigger edge ${e.id}: node "${target.id}" is a trigger and cannot be the target of a trigger edge (triggers are entry points)`,
      target.id,
    );
  }
}

function checkDataFanIn(graph: ProcedureGraph, problems: Problems): void {
  const dataTargets = new Map<string, { node: string; field: string }[]>();
  for (const e of graph.dataEdges) {
    const key = `${e.to.node}::${e.to.field}`;
    dataTargets.set(key, [...(dataTargets.get(key) ?? []), e.to]);
  }
  for (const [key, targets] of dataTargets) {
    const target = targets[0];
    if (targets.length < 2 || !target) continue;
    problems.error(
      "dataFanIn",
      { node: target.node, field: target.field },
      `data field has more than one source: ${key}`,
      target.node,
    );
  }
}

// Cycle detection over trigger edges: a single Kahn's pass over every node the
// edges reference. Shares the executor's `kahn` helper. Skipped once an earlier
// check has failed (unknown refs would make the pass meaningless).
function checkTriggerCycles(graph: ProcedureGraph, problems: Problems): void {
  if (graph.triggerEdges.length === 0 || problems.hasError) return;
  const allReferencedNodes = new Set<string>();
  for (const e of graph.triggerEdges) {
    allReferencedNodes.add(e.from.node);
    allReferencedNodes.add(e.to.node);
  }
  if (kahn(graph, allReferencedNodes) !== null) return;
  const nodes = cycleMembers(
    allReferencedNodes,
    graph.triggerEdges.map((e) => [e.from.node, e.to.node] as const),
  );
  problems.error(
    "triggerCycle",
    { nodes: nodes.join(", ") },
    `cycle detected in trigger edges: ${quotedList(nodes)}`,
    nodes[0],
  );
}

// Data nodes are evaluated on demand, pulling their inputs from other data
// nodes: a loop among them can never be evaluated. Other nodes only read the
// last output of their source, so a data edge back to them is no cycle.
function checkDataCycles(
  graph: ProcedureGraph,
  nodeById: Map<string, GraphNode>,
  problems: Problems,
): void {
  const isData = (id: string) => nodeById.get(id)?.kind === "data";
  const edges = graph.dataEdges
    .filter((e) => isData(e.from.node) && isData(e.to.node))
    .map((e) => [e.from.node, e.to.node] as const);
  if (edges.length === 0) return;
  const nodes = cycleMembers(
    edges.flatMap(([from, to]) => [from, to]),
    edges,
  );
  if (nodes.length === 0) return;
  problems.error(
    "dataCycle",
    { nodes: nodes.join(", ") },
    `cycle detected in data edges: ${quotedList(nodes)}`,
    nodes[0],
  );
}

/**
 * Every finding of a graph, structured. Checks the two-edge-type semantics:
 *  - node ids are unique;
 *  - trigger edges form a DAG; only whitelisted sources may diverge.
 *  - trigger nodes are entry points: nothing may trigger into them, and they
 *    live at the top level only.
 *  - if-branch labels are restricted to "then" / "else".
 *  - data edges are at most one-per-(node, field), with no loop among data
 *    nodes.
 *  - every edge endpoint must reference an existing node.
 *  - group nodes have valid port wiring and recursively-valid subgraphs.
 */
export function graphProblems(
  graph: ProcedureGraph,
  depth = 0,
): GraphProblem[] {
  const problems = new Problems();
  const nodeById = new Map<string, ProcedureGraph["nodes"][number]>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  checkDuplicateNodeIds(graph, problems);
  checkUnknownNodeRefs(graph, nodeById, problems);
  checkTriggerDivergence(graph, nodeById, problems);
  checkTriggerNodesAreEntryPoints(graph, nodeById, problems);
  checkDataFanIn(graph, problems);
  checkTriggerCycles(graph, problems);
  checkDataCycles(graph, nodeById, problems);

  for (const node of graph.nodes) {
    // The run starts from the triggers of the top level only.
    if (depth > 0 && node.kind === "trigger") {
      problems.error(
        "nestedTrigger",
        { node: node.id },
        `node "${node.id}" is a trigger inside a group (triggers must live at the top level)`,
        node.id,
      );
    }
    if (isGroupNode(node)) validateGroupNode(node, depth, problems);
  }

  return problems.list;
}

/** The validator's findings as plain messages: what the executor reads. */
export function validateGraph(graph: ProcedureGraph): ValidateResult {
  const problems = graphProblems(graph);
  const messagesOf = (severity: GraphProblem["severity"]) =>
    problems.filter((p) => p.severity === severity).map((p) => p.message);
  const errors = messagesOf("error");
  const warnings = messagesOf("warning");
  return errors.length === 0
    ? { ok: true, warnings }
    : { ok: false, errors, warnings };
}

/**
 * A group declares its body either by reference (`templateId`) or inline
 * (`subgraph`), never both and never neither. Returns false when the pair is
 * wrong, which is fatal for the node: nothing below can be checked without a
 * body.
 */
function validateGroupBodySource(node: GroupNode, problems: Problems): boolean {
  const id = node.id;
  const hasTemplate = node.templateId !== undefined;
  const hasSubgraph = node.subgraph !== undefined;
  if (hasTemplate && hasSubgraph) {
    problems.error(
      "groupBodyBoth",
      { group: id },
      `group "${id}": exactly one of templateId / subgraph must be set (both are set)`,
      id,
    );
    return false;
  }
  if (!hasTemplate && !hasSubgraph) {
    problems.error(
      "groupBodyNone",
      { group: id },
      `group "${id}": exactly one of templateId / subgraph must be set (neither is set)`,
      id,
    );
    return false;
  }
  return true;
}

/**
 * Port-name uniqueness within (kind, direction). Two ports may share a name
 * only if they differ in kind or direction.
 */
function validateGroupPortNames(node: GroupNode, problems: Problems): void {
  const id = node.id;
  const portSeen = new Map<string, number>();
  for (const p of node.ports) {
    const key = `${p.kind}/${p.direction}/${p.name}`;
    portSeen.set(key, (portSeen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of portSeen) {
    if (count > 1) {
      problems.error(
        "groupDuplicatePort",
        { group: id, port: key },
        `group "${id}": duplicate port (${key}) — port names must be unique within a direction+kind`,
        id,
      );
    }
  }
}

/**
 * Sentinel presence: exactly one groupInput and exactly one groupOutput. The
 * counts are returned because the port-wiring check below only runs when both
 * are unique.
 */
function validateGroupSentinels(
  subgraph: ProcedureGraph,
  id: string,
  problems: Problems,
): { groupInputCount: number; groupOutputId: string | undefined } {
  const groupInputs = subgraph.nodes.filter((n) => n.kind === "groupInput");
  const groupOutputs = subgraph.nodes.filter((n) => n.kind === "groupOutput");
  if (groupInputs.length !== 1) {
    problems.error(
      "groupInputCount",
      { group: id, count: groupInputs.length },
      `group "${id}": subgraph must contain exactly one groupInput node (found ${groupInputs.length})`,
      id,
    );
  }
  if (groupOutputs.length !== 1) {
    problems.error(
      "groupOutputCount",
      { group: id, count: groupOutputs.length },
      `group "${id}": subgraph must contain exactly one groupOutput node (found ${groupOutputs.length})`,
      id,
    );
  }
  return {
    groupInputCount: groupInputs.length,
    groupOutputId: groupOutputs.length === 1 ? groupOutputs[0].id : undefined,
  };
}

/**
 * Every data-out port of the group needs exactly one inner data edge feeding
 * groupOutput. None is a warning -- the group still runs, consumers just read
 * undefined. More than one is an error: the executor cannot pick a winner.
 *
 * data-in / trigger-in / trigger-out declared-but-unused are warning-only and
 * deliberately not reported here, to keep the error surface tight.
 */
function validateGroupDataOutWiring(
  node: GroupNode,
  subgraph: ProcedureGraph,
  groupOutputId: string,
  problems: Problems,
): void {
  const id = node.id;
  for (const p of node.ports) {
    if (p.kind !== "data" || p.direction !== "out") continue;
    const incoming = subgraph.dataEdges.filter(
      (e) => e.to.node === groupOutputId && e.to.field === p.name,
    );
    if (incoming.length === 0) {
      problems.warning(
        "groupOutputUnwired",
        { group: id, port: p.name },
        `group "${id}": data-out port "${p.name}" has no incoming data edge to groupOutput`,
        id,
      );
    } else if (incoming.length > 1) {
      problems.error(
        "groupOutputMultiple",
        { group: id, port: p.name, count: incoming.length },
        `group "${id}": data-out port "${p.name}" has ${incoming.length} incoming data edges to groupOutput (expected exactly one)`,
        id,
      );
    }
  }
}

/**
 * Validates a single group node:
 *  - exactly one of templateId / subgraph is set;
 *  - for local groups (with subgraph): exactly one groupInput / one groupOutput;
 *  - declared data-out ports are wired to the groupOutput sentinel (unwired
 *    is a warning, multiple writers an error); other port kinds get no
 *    wiring check;
 *  - at least one trigger-in port exists (otherwise the group can never start);
 *  - subgraph is recursively valid (findings prefixed with `group:<id> > `
 *    and reported on the group).
 */
function validateGroupNode(
  node: GroupNode,
  depth: number,
  problems: Problems,
): void {
  const id = node.id;

  if (!validateGroupBodySource(node, problems)) return;
  validateGroupPortNames(node, problems);

  // At least one trigger-input port (applies to template instances too --
  // otherwise the group can never start).
  const hasTriggerIn = node.ports.some(
    (p) => p.kind === "trigger" && p.direction === "in",
  );
  if (!hasTriggerIn) {
    problems.error(
      "groupNoTriggerIn",
      { group: id },
      `group "${id}": must declare at least one trigger-input port (otherwise the group can never start)`,
      id,
    );
  }

  // Template instances are validated at template-write time (Task C4.3);
  // skip sentinel-presence and port-wiring checks here.
  const subgraph = node.subgraph;
  if (node.templateId !== undefined || !subgraph) return;

  const { groupInputCount, groupOutputId } = validateGroupSentinels(
    subgraph,
    id,
    problems,
  );
  if (groupInputCount === 1 && groupOutputId !== undefined) {
    validateGroupDataOutWiring(node, subgraph, groupOutputId, problems);
  }

  if (depth + 1 > MAX_GROUP_DEPTH) {
    problems.error(
      "groupTooDeep",
      { group: id, max: MAX_GROUP_DEPTH },
      `group "${id}": groups are nested more than ${MAX_GROUP_DEPTH} levels deep`,
      id,
    );
    return;
  }

  // Recursive subgraph validation. Findings propagate up with the
  // `group:<id> > ` prefix so their source stays attributable, and are
  // reported on this group, the node of this graph that holds them.
  for (const inner of graphProblems(subgraph, depth + 1)) {
    problems.list.push({
      ...inner,
      message: `group:${id} > ${inner.message}`,
      nodeId: id,
    });
  }
}
