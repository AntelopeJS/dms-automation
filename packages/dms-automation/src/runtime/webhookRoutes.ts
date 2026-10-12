import { GetModel } from "@antelopejs/interface-database-decorators";
import { ProcedureModel } from "../db/models/procedure.model";
import { DATABASE_NAME } from "../types/constants";
import type { GraphNode, ProcedureGraph } from "../types/graph";
import { webhookRouteOf, webhookTrigger } from "./builtins/triggers/webhook";
import { parseGraphSafe } from "./describe";
import type { GraphIssue } from "./graphIssues";

/**
 * The routes the webhooks of the procedures answer on, across procedures:
 * the router hands a call to the first handler registered for its route, so
 * two procedures on one route means one of them never runs.
 */

function webhookNodesOf(graph: ProcedureGraph | undefined): GraphNode[] {
  return (graph?.nodes ?? []).filter(
    (n) => n.kind === "trigger" && n.typeId === webhookTrigger.id,
  );
}

const routeKey = ({ method, path }: { method: string; path: string }) =>
  `${method} ${path}`;

/**
 * The webhooks of `graph` another enabled procedure already answers on, as
 * issues naming that procedure: blocking when `graph` is about to be
 * enabled, a warning on a draft.
 */
export async function webhookConflicts(
  graph: ProcedureGraph,
  procedureId: string | undefined,
  severity: GraphIssue["severity"],
): Promise<GraphIssue[]> {
  const webhooks = webhookNodesOf(graph);
  if (webhooks.length === 0) return [];
  const owners = new Map<string, string>();
  const enabled = await GetModel(ProcedureModel, DATABASE_NAME).listEnabled();
  for (const other of enabled) {
    if (other._id === procedureId) continue;
    for (const node of webhookNodesOf(parseGraphSafe(other.graph))) {
      const route = routeKey(webhookRouteOf(node.config));
      if (!owners.has(route)) owners.set(route, other.name);
    }
  }
  return webhooks.flatMap((node): GraphIssue[] => {
    const { method, path } = webhookRouteOf(node.config);
    const owner = owners.get(routeKey({ method, path }));
    if (!owner) return [];
    return [
      {
        severity,
        code: "webhookPathTaken",
        params: { method, path, procedure: owner },
        message: `${method} ${path} already answers for the procedure "${owner}"`,
        nodeId: node.id,
      },
    ];
  });
}

/**
 * `graph` with its webhooks moved to paths no procedure uses yet (`-2`,
 * `-3`… appended): a new procedure never shares the route of another.
 */
export async function withFreeWebhookPaths(
  graph: ProcedureGraph,
): Promise<ProcedureGraph> {
  if (webhookNodesOf(graph).length === 0) return graph;
  const taken = new Set<string>();
  for (const p of await GetModel(ProcedureModel, DATABASE_NAME).getAll()) {
    for (const node of webhookNodesOf(parseGraphSafe(p.graph))) {
      taken.add(webhookRouteOf(node.config).path);
    }
  }
  const copy = structuredClone(graph);
  for (const node of webhookNodesOf(copy)) {
    const { path } = webhookRouteOf(node.config);
    if (!path) continue;
    let free = path;
    for (let n = 2; taken.has(free); n++) free = `${path}-${n}`;
    taken.add(free);
    if (free !== path) node.config = { ...node.config, path: free };
  }
  return copy;
}
