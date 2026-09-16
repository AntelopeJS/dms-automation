import type { ProcedureGraph, TriggerEdge } from "../types/graph";
import { topoFromPort } from "./topo";

/**
 * Per-fire walk state. Each `fireTrigger(source, port, ...)` call creates a
 * new SubWalk seeded at `(sourceNode, sourcePort?)` and topo-walks the
 * trigger-reachable subgraph.
 *
 * The seed node itself is NOT part of the walked subgraph; it executed
 * either at the run boundary (bootstrap trigger) or in a parent sub-walk.
 *
 * Three pieces of per-fire state govern the walk:
 *  - `executed`        — node ids that have already run in this sub-walk.
 *  - `branchDecisions` — for each branching source, the set of ports it
 *                        chose to fire. Read by `hasLiveIncoming` to decide
 *                        which downstream trigger edges are live.
 *  - `claimedPorts`    — `(sourceNodeId, port)` pairs whose downstream
 *                        was processed explicitly by a nested fire from
 *                        that source's execute (via `ctx.fireTrigger`).
 *                        The outer topo walk must NOT auto-propagate
 *                        through these — the nested fire already did.
 */
export class SubWalk {
  readonly graph: ProcedureGraph;
  readonly sourceNodeId: string;
  readonly sourcePort: string | undefined;
  readonly executed = new Set<string>();
  readonly branchDecisions = new Map<string, Set<string>>();
  readonly claimedPorts = new Map<string, Set<string>>();
  private order: string[] | null = null;

  constructor(
    graph: ProcedureGraph,
    sourceNodeId: string,
    sourcePort: string | undefined,
  ) {
    this.graph = graph;
    this.sourceNodeId = sourceNodeId;
    this.sourcePort = sourcePort;
  }

  topoOrder(): string[] {
    if (this.order === null) {
      this.order = topoFromPort(this.graph, this.sourceNodeId, this.sourcePort);
    }
    return this.order;
  }

  hasLiveIncoming(nodeId: string): boolean {
    const incoming = this.graph.triggerEdges.filter(
      (e) => e.to.node === nodeId,
    );
    for (const edge of incoming) {
      if (this.isEdgeLive(edge)) return true;
    }
    return false;
  }

  private isEdgeLive(edge: TriggerEdge): boolean {
    const source = edge.from.node;
    const port = edge.from.branch;

    if (source === this.sourceNodeId) {
      if (this.sourcePort === undefined) return true;
      return port === this.sourcePort;
    }

    if (!this.executed.has(source)) return false;

    // Outer walks must NOT re-propagate through ports the source's execute
    // already claimed via ctx.fireTrigger — the nested sub-walk handled
    // that downstream.
    if (port !== undefined && this.claimedPorts.get(source)?.has(port)) {
      return false;
    }

    const decision = this.branchDecisions.get(source);
    if (decision === undefined) return true;
    if (port === undefined) return false;
    return decision.has(port);
  }

  markExecuted(nodeId: string): void {
    this.executed.add(nodeId);
  }

  /**
   * Union additional branch ports into the source node's decision set.
   * Called by the outer walk after a node's execute returns — with the
   * ports chosen via ctx.continueWith, or with the default continuation
   * ports (minus any port already claimed by ctx.fireTrigger).
   */
  recordBranch(nodeId: string, branches: Iterable<string>): void {
    let set = this.branchDecisions.get(nodeId);
    if (!set) {
      set = new Set();
      this.branchDecisions.set(nodeId, set);
    }
    for (const b of branches) set.add(b);
  }

  /**
   * Mark a `(sourceNodeId, port)` pair as having had its downstream handled
   * by an explicit nested fire. The outer walk's hasLiveIncoming treats
   * edges leaving this port as dead.
   */
  claimPort(nodeId: string, port: string): void {
    let set = this.claimedPorts.get(nodeId);
    if (!set) {
      set = new Set();
      this.claimedPorts.set(nodeId, set);
    }
    set.add(port);
  }
}
