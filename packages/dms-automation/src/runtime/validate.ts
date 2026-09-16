import {
  type GraphNode,
  type GroupNode,
  isGroupNode,
  type ProcedureGraph,
} from "../types/graph";
import { nodeKinds } from "./nodeKinds";
import { kahn } from "./topo";

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

// Divergence (>1 outgoing trigger edge) and per-source branch labels are
// derived from the kind registry — the source of truth is each kind's
// declared port shape, not a hand-maintained list. `group` isn't in the
// registry (it's handled by `flatten.ts`), and `groupInput` registers with
// no ports so `mayDiverge` returns false for it even though its outgoing
// edges are one-per-declared-port and managed by the editor — both are
// therefore allowed unconditionally below.

function checkUnknownNodeRefs(
  graph: ProcedureGraph,
  nodeById: Map<string, GraphNode>,
  errors: string[],
): void {
  for (const e of graph.triggerEdges) {
    if (!nodeById.has(e.from.node)) {
      errors.push(`trigger edge ${e.id}: unknown source node "${e.from.node}"`);
    }
    if (!nodeById.has(e.to.node)) {
      errors.push(`trigger edge ${e.id}: unknown target node "${e.to.node}"`);
    }
  }
  for (const e of graph.dataEdges) {
    if (!nodeById.has(e.from.node)) {
      errors.push(`data edge ${e.id}: unknown source node "${e.from.node}"`);
    }
    if (!nodeById.has(e.to.node)) {
      errors.push(`data edge ${e.id}: unknown target node "${e.to.node}"`);
    }
  }
}

function checkTriggerDivergence(
  graph: ProcedureGraph,
  nodeById: Map<string, GraphNode>,
  errors: string[],
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
      errors.push(
        `trigger source cannot diverge: node "${sourceId}" (${src.kind}) has ${count} outgoing trigger edges`,
      );
    }
  }
  const ifBranches = new Set(nodeKinds.metaOf("if")?.sidePorts ?? []);
  for (const e of graph.triggerEdges) {
    const src = nodeById.get(e.from.node);
    if (!src) continue;
    if (src.kind === "if" && e.from.branch !== undefined) {
      if (!ifBranches.has(e.from.branch)) {
        errors.push(
          `trigger edge ${e.id}: if-branch must be one of ${[...ifBranches].map((b) => `"${b}"`).join(" / ")} (got "${e.from.branch}")`,
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
  errors: string[],
): void {
  for (const e of graph.triggerEdges) {
    const target = nodeById.get(e.to.node);
    if (target?.kind !== "trigger") continue;
    errors.push(
      `trigger edge ${e.id}: node "${target.id}" is a trigger and cannot be the target of a trigger edge (triggers are entry points)`,
    );
  }
}

function checkDataFanIn(graph: ProcedureGraph, errors: string[]): void {
  const dataTargets = new Map<string, number>();
  for (const e of graph.dataEdges) {
    const key = `${e.to.node}::${e.to.field}`;
    dataTargets.set(key, (dataTargets.get(key) ?? 0) + 1);
  }
  for (const [key, count] of dataTargets) {
    if (count > 1) {
      errors.push(`data field has more than one source: ${key}`);
    }
  }
}

// Cycle detection over trigger edges: a single Kahn's pass over every node the
// edges reference. Shares the executor's `kahn` helper. Skipped once an earlier
// check has failed (unknown refs would make the pass meaningless).
function checkTriggerCycles(graph: ProcedureGraph, errors: string[]): void {
  if (graph.triggerEdges.length === 0 || errors.length !== 0) return;
  const allReferencedNodes = new Set<string>();
  for (const e of graph.triggerEdges) {
    allReferencedNodes.add(e.from.node);
    allReferencedNodes.add(e.to.node);
  }
  if (kahn(graph, allReferencedNodes) === null) {
    errors.push("cycle detected in trigger edges");
  }
}

/**
 * Validates a ProcedureGraph against the two-edge-type semantics:
 *  - trigger edges form a DAG; only whitelisted sources may diverge.
 *  - trigger nodes are entry points: nothing may trigger into them.
 *  - if-branch labels are restricted to "then" / "else".
 *  - data edges are at most one-per-(node, field).
 *  - every edge endpoint must reference an existing node.
 *  - group nodes have valid port wiring and recursively-valid subgraphs.
 */
export function validateGraph(graph: ProcedureGraph): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeById = new Map<string, ProcedureGraph["nodes"][number]>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  checkUnknownNodeRefs(graph, nodeById, errors);
  checkTriggerDivergence(graph, nodeById, errors);
  checkTriggerNodesAreEntryPoints(graph, nodeById, errors);
  checkDataFanIn(graph, errors);
  checkTriggerCycles(graph, errors);

  // Group node validation: port wiring + recursive subgraph validation.
  for (const node of graph.nodes) {
    if (!isGroupNode(node)) continue;
    validateGroupNode(node, errors, warnings);
  }

  return errors.length === 0
    ? { ok: true, warnings }
    : { ok: false, errors, warnings };
}

/**
 * Validates a single group node:
 *  - exactly one of templateId / subgraph is set;
 *  - for local groups (with subgraph): exactly one groupInput / one groupOutput;
 *  - declared data-out ports are wired to the groupOutput sentinel (unwired
 *    is a warning, multiple writers an error); other port kinds get no
 *    wiring check;
 *  - at least one trigger-in port exists (otherwise the group can never start);
 *  - subgraph is recursively valid (errors prefixed with `group:<id> > `).
 *
 * Declared-but-unused data-in / trigger-in / trigger-out ports could be
 * surfaced as warnings (the `warnings` channel exists); currently they're
 * skipped to keep the error surface tight.
 */
/**
 * A group declares its body either by reference (`templateId`) or inline
 * (`subgraph`), never both and never neither. Returns false when the pair is
 * wrong, which is fatal for the node: nothing below can be checked without a
 * body.
 */
function validateGroupBodySource(
  node: GroupNode,
  id: string,
  errors: string[],
): boolean {
  const hasTemplate = node.templateId !== undefined;
  const hasSubgraph = node.subgraph !== undefined;
  if (hasTemplate && hasSubgraph) {
    errors.push(
      `group "${id}": exactly one of templateId / subgraph must be set (both are set)`,
    );
    return false;
  }
  if (!hasTemplate && !hasSubgraph) {
    errors.push(
      `group "${id}": exactly one of templateId / subgraph must be set (neither is set)`,
    );
    return false;
  }
  return true;
}

/**
 * Port-name uniqueness within (kind, direction). Two ports may share a name
 * only if they differ in kind or direction.
 */
function validateGroupPortNames(
  node: GroupNode,
  id: string,
  errors: string[],
): void {
  const portSeen = new Map<string, number>();
  for (const p of node.ports) {
    const key = `${p.kind}/${p.direction}/${p.name}`;
    portSeen.set(key, (portSeen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of portSeen) {
    if (count > 1) {
      errors.push(
        `group "${id}": duplicate port (${key}) — port names must be unique within a direction+kind`,
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
  errors: string[],
): { groupInputCount: number; groupOutputId: string | undefined } {
  const groupInputs = subgraph.nodes.filter((n) => n.kind === "groupInput");
  const groupOutputs = subgraph.nodes.filter((n) => n.kind === "groupOutput");
  if (groupInputs.length !== 1) {
    errors.push(
      `group "${id}": subgraph must contain exactly one groupInput node (found ${groupInputs.length})`,
    );
  }
  if (groupOutputs.length !== 1) {
    errors.push(
      `group "${id}": subgraph must contain exactly one groupOutput node (found ${groupOutputs.length})`,
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
  errors: string[],
  warnings: string[],
): void {
  const id = node.id;
  for (const p of node.ports) {
    if (p.kind !== "data" || p.direction !== "out") continue;
    const incoming = subgraph.dataEdges.filter(
      (e) => e.to.node === groupOutputId && e.to.field === p.name,
    );
    if (incoming.length === 0) {
      warnings.push(
        `group "${id}": data-out port "${p.name}" has no incoming data edge to groupOutput`,
      );
    } else if (incoming.length > 1) {
      errors.push(
        `group "${id}": data-out port "${p.name}" has ${incoming.length} incoming data edges to groupOutput (expected exactly one)`,
      );
    }
  }
}

function validateGroupNode(
  node: GroupNode,
  errors: string[],
  warnings: string[],
): void {
  const id = node.id;

  if (!validateGroupBodySource(node, id, errors)) return;
  validateGroupPortNames(node, id, errors);

  // At least one trigger-input port (applies to template instances too --
  // otherwise the group can never start).
  const hasTriggerIn = node.ports.some(
    (p) => p.kind === "trigger" && p.direction === "in",
  );
  if (!hasTriggerIn) {
    errors.push(
      `group "${id}": must declare at least one trigger-input port (otherwise the group can never start)`,
    );
  }

  // Template instances are validated at template-write time (Task C4.3);
  // skip sentinel-presence and port-wiring checks here.
  const subgraph = node.subgraph;
  if (node.templateId !== undefined || !subgraph) return;

  const { groupInputCount, groupOutputId } = validateGroupSentinels(
    subgraph,
    id,
    errors,
  );
  if (groupInputCount === 1 && groupOutputId !== undefined) {
    validateGroupDataOutWiring(node, subgraph, groupOutputId, errors, warnings);
  }

  // Recursive subgraph validation. Both errors and warnings propagate up with
  // the `group:<id> > ` prefix so the source of nested findings stays
  // attributable.
  const inner = validateGraph(subgraph);
  if (!inner.ok) {
    for (const e of inner.errors) {
      errors.push(`group:${id} > ${e}`);
    }
  }
  for (const w of inner.warnings) {
    warnings.push(`group:${id} > ${w}`);
  }
}
