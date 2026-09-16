import type { DataEdge, GraphNode } from "../types/graph";

export type DataNodeEvaluator = (
  sourceNodeId: string,
) => Record<string, unknown> | undefined;

/**
 * Run-scoped output store with version-stamped invalidation.
 *
 * Two kinds of nodes write here:
 *  - non-data nodes (triggers, actions, control flow) push their outputs
 *    via `setOutput(...)`. Each call bumps the source's version, which
 *    invalidates any downstream data-node cache entries that read from it.
 *  - data nodes are pulled lazily via `evaluateDataNode`; their results
 *    are stored via `cacheData(...)` together with the set of upstream
 *    versions seen at evaluation time. A subsequent pull checks those
 *    versions and recomputes if any have advanced.
 *
 * The lazy/data-DAG path has no cycle detection here — `validate.ts` only
 * checks trigger-edge cycles; data-edge cycles are caught at evaluation
 * time by the data-node evaluator's evalStack guard (executor.ts).
 */
export class DataCache {
  private outputs = new Map<string, unknown>();
  private versions = new Map<string, number>();
  /** For data nodes: the upstream versions seen when the cache was filled. */
  private dataDeps = new Map<string, Map<string, number>>();

  /** Read the most recent value written for `nodeId`, if any. */
  getOutput(nodeId: string): unknown {
    return this.outputs.get(nodeId);
  }

  /**
   * Write a node's output. Bumps the version, invalidating any data cache
   * entry that depends on this source.
   */
  setOutput(nodeId: string, value: unknown): void {
    this.outputs.set(nodeId, value);
    this.versions.set(nodeId, (this.versions.get(nodeId) ?? 0) + 1);
  }

  versionOf(nodeId: string): number {
    return this.versions.get(nodeId) ?? 0;
  }

  /**
   * Returns the cached data-node result if every recorded upstream version
   * still matches; otherwise undefined (caller must recompute).
   */
  getCachedData(nodeId: string): Record<string, unknown> | undefined {
    if (!this.outputs.has(nodeId)) return undefined;
    const deps = this.dataDeps.get(nodeId);
    if (!deps) return undefined;
    for (const [depId, seen] of deps) {
      if (this.versionOf(depId) !== seen) {
        // Stale: a dependency changed. Drop the cache entry so future
        // reads from this node go through evaluation again.
        this.outputs.delete(nodeId);
        this.dataDeps.delete(nodeId);
        return undefined;
      }
    }
    return this.outputs.get(nodeId) as Record<string, unknown>;
  }

  /**
   * Cache a data-node result together with the upstream versions it was
   * computed against. Bumps the node's own version so any *downstream*
   * data-node caches dependent on this node revalidate.
   */
  cacheData(
    nodeId: string,
    value: Record<string, unknown>,
    deps: Iterable<string>,
  ): void {
    this.setOutput(nodeId, value);
    const depMap = new Map<string, number>();
    for (const depId of deps) depMap.set(depId, this.versionOf(depId));
    this.dataDeps.set(nodeId, depMap);
  }

  /** Whether any output has been written for `nodeId`. */
  has(nodeId: string): boolean {
    return this.outputs.has(nodeId);
  }
}

/**
 * Builds the input record for a node by merging static config with
 * data-edge wired fields. For each incoming data edge, pulls the upstream
 * output via `cache.getOutput(...)` or — when the source is a data-kind
 * node not yet evaluated — via the optional `evaluateDataNode` callback.
 *
 * Edges whose source has no output and no evaluator hit are skipped, and
 * the target field falls back to its static config value (if any).
 */
export function resolveInputs(
  node: GraphNode,
  dataEdges: DataEdge[],
  cache: DataCache,
  evaluateDataNode?: DataNodeEvaluator,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...node.config };

  for (const edge of dataEdges) {
    if (edge.to.node !== node.id) continue;

    let upstream = cache.getOutput(edge.from.node);

    if (upstream === undefined && evaluateDataNode) {
      upstream = evaluateDataNode(edge.from.node);
    }

    // Upstream must be an object to expose named ports. Triggers / actions
    // that emit primitives have no ports to read; skip such edges rather
    // than crashing on `port in primitive`.
    if (upstream === null || typeof upstream !== "object") continue;

    const record = upstream as Record<string, unknown>;
    if (edge.from.port in record) {
      result[edge.to.field] = record[edge.from.port];
    }
  }

  return result;
}
