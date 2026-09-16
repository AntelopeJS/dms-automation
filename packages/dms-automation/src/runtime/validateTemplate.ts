import { isGroupNode, type ProcedureGraph } from "../types/graph";
import type { TemplateCache } from "./resolveSubgraph";

/**
 * Returns the cycle path (array of templateIds, candidate id at both ends if
 * the candidate participates) if introducing `candidate` (with
 * `candidateSubgraph`) would create a cycle in the template-reference graph;
 * null otherwise.
 *
 * Algorithm: DFS the candidate's subgraph for `group` nodes. For template
 * instances (a group node with a `templateId`), recurse into the referenced
 * template's subgraph. Local group nodes (no `templateId`, but `subgraph`
 * present) are NOT recursed-as-a-template — they don't participate in the
 * template-reference graph themselves — but we DO descend into their inline
 * `subgraph` because it can contain nested template instances. Track visited
 * templateIds along the current DFS path; if a path revisits a template we've
 * already pushed, return the cycle.
 *
 * Used by:
 *  - POST /api/automation/templates  (candidate is the new template; candidateId
 *    may be a fresh id)
 *  - PUT  /api/automation/templates/:id  (candidate is the updated template)
 */
export function findTemplateRefCycle(
  candidateId: string,
  candidateSubgraph: ProcedureGraph,
  lookup: TemplateCache,
): string[] | null {
  const onPath = new Set<string>([candidateId]);
  const path: string[] = [candidateId];
  const visitedClean = new Set<string>();

  return dfs(candidateSubgraph, {
    candidateId,
    onPath,
    path,
    visitedClean,
    lookup,
  });
}

/**
 * The walk's state. `onPath` and `visitedClean` are both sets of template ids
 * and were adjacent positional parameters, where swapping them silently turned
 * the cycle check into a memoisation bug.
 */
interface RefWalk {
  candidateId: string;
  onPath: Set<string>;
  path: string[];
  visitedClean: Set<string>;
  lookup: TemplateCache;
}

function dfs(subgraph: ProcedureGraph, walk: RefWalk): string[] | null {
  const { candidateId, onPath, path, visitedClean, lookup } = walk;
  for (const n of subgraph.nodes) {
    if (!isGroupNode(n)) continue;
    const g = n;

    if (g.templateId !== undefined) {
      const refId = g.templateId;

      // Direct self-reference to the candidate (covers both A→A and the
      // general onPath revisit when the candidate is the head of `path`).
      if (refId === candidateId) {
        return [...path, refId];
      }

      // Indirect cycle — referenced template is already on the DFS path.
      if (onPath.has(refId)) {
        const startIdx = path.indexOf(refId);
        return [...path.slice(startIdx), refId];
      }

      // Already proven clean in a prior DFS branch — skip re-traversal.
      if (visitedClean.has(refId)) continue;

      // Resolve the referenced template. If missing (unknown templateId), the
      // route layer will report it; not a cycle, skip.
      const ref = lookup.get(refId);
      if (!ref) continue;

      onPath.add(refId);
      path.push(refId);
      const found = dfs(ref.subgraph, walk);
      if (found) return found;
      path.pop();
      onPath.delete(refId);
      // Fully traversed without finding a cycle — memoize as clean.
      visitedClean.add(refId);
    } else if (g.subgraph) {
      // Local group: doesn't participate in the template-ref graph itself,
      // but its inline subgraph can contain template instances. Recurse
      // without touching `onPath` / `path` (no new template frame).
      const found = dfs(g.subgraph, walk);
      if (found) return found;
    }
  }
  return null;
}
