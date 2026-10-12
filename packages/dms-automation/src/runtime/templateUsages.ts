import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  AutomationTemplateModel,
  type AutomationTemplateRow,
} from "../db/models/automation_template.model";
import { ProcedureModel } from "../db/models/procedure.model";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import type { Procedure } from "../db/tables/procedure.table";
import { DATABASE_NAME } from "../types/constants";
import {
  type GraphNode,
  isGroupNode,
  type ProcedureGraph,
  walkNodesRecursive,
} from "../types/graph";
import { labelOf } from "./describe";
import { validateGraph } from "./validate";

/**
 * What a template change does to the procedures placing it: their version
 * moves on, a now-invalid one is disabled, a usage is forked to a local group
 * before the template goes.
 */

/** The next version of a procedure: its graph, as runs see it, changed. */
function nextVersion(procedure: Procedure): number {
  return (procedure.version ?? 1) + 1;
}

/** The runs of the previous graph now read as an older version. */
async function markOlderRuns(procedureId: string, version: number) {
  const runs = GetModel(ProcedureRunModel, DATABASE_NAME);
  await runs.markOlderVersions(procedureId, version);
}

async function usingProcedureIds(templateId: string): Promise<Set<string>> {
  const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
  const usages = await templateModel.findUsages(templateId);
  return new Set(usages.map((u) => u.procedureId));
}

/**
 * A template edit changes what the procedures placing it run: their version
 * moves on, so a run tells which graph it executed. Called once, by the
 * instance that took the edit, never by the peers replaying it.
 */
export async function bumpVersionOfUsages(templateId: string): Promise<void> {
  const procedureModel = GetModel(ProcedureModel, DATABASE_NAME);
  for (const id of await usingProcedureIds(templateId)) {
    const p = await procedureModel.get(id);
    if (!p) continue;
    const version = nextVersion(p);
    await procedureModel.update(id, { version });
    await markOlderRuns(id, version);
  }
}

/**
 * Re-validate every procedure that references `templateId`. If a procedure
 * fails validation and is currently enabled, disable it (so a broken
 * template can't keep firing trigger subscriptions against a graph that
 * won't execute cleanly). Returns whether any procedure uses the template:
 * the caller then reconciles trigger subscriptions.
 */
export async function disableInvalidUsages(
  templateId: string,
): Promise<boolean> {
  const procedureModel = GetModel(ProcedureModel, DATABASE_NAME);
  const procIds = await usingProcedureIds(templateId);
  for (const id of procIds) {
    const p = await procedureModel.get(id);
    if (!p) continue;
    let graph: ProcedureGraph;
    try {
      graph = JSON.parse(p.graph) as ProcedureGraph;
    } catch (err) {
      Logging.Error(
        `[dms-automation] template cascade: skipping procedure "${id}" — graph JSON parse failed:`,
        err,
      );
      continue;
    }
    const verdict = validateGraph(graph);
    if (!verdict.ok && p.enabled) {
      await procedureModel.update(id, {
        enabled: false,
        updated_at: new Date(),
      });
    }
  }
  return procIds.size > 0;
}

/**
 * The node `nodeId` of a stored graph, inside the local groups of
 * `groupPath` (outermost first) when given, else wherever it sits.
 */
function findNode(
  graph: ProcedureGraph,
  nodeId: string,
  groupPath?: readonly string[],
): GraphNode | undefined {
  if (!groupPath) {
    return [...walkNodesRecursive(graph)].find((n) => n.id === nodeId);
  }
  let level: ProcedureGraph | undefined = graph;
  for (const groupId of groupPath) {
    const group: GraphNode | undefined = level?.nodes.find(
      (n) => n.id === groupId,
    );
    level = group && isGroupNode(group) ? group.subgraph : undefined;
  }
  return level?.nodes.find((n) => n.id === nodeId);
}

/**
 * Turn the template instance `nodeId` of a procedure into a local group
 * holding a deep clone of `template`'s graph. A no-op when the node is gone
 * or already local.
 */
export async function forkUsage(
  procedureId: string,
  nodeId: string,
  groupPath: readonly string[] | undefined,
  templateOf: (id: string) => AutomationTemplateRow | undefined,
): Promise<void> {
  const procedureModel = GetModel(ProcedureModel, DATABASE_NAME);
  const p = await procedureModel.get(procedureId);
  if (!p) return;
  let graph: ProcedureGraph;
  try {
    graph = JSON.parse(p.graph) as ProcedureGraph;
  } catch {
    return;
  }
  const node = findNode(graph, nodeId, groupPath);
  if (!node || !isGroupNode(node) || !node.templateId) return;
  const tpl = templateOf(node.templateId);
  if (!tpl) return;
  delete node.templateId;
  node.subgraph = structuredClone(tpl.subgraph);
  // The local group keeps the template's name, unless it was given its own.
  const group = node as GraphNode & { label?: string };
  if (!labelOf(group)) group.label = tpl.name;
  // The graph changed under any builder open on it: new version, new revision.
  const version = nextVersion(p);
  await procedureModel.update(procedureId, {
    graph: JSON.stringify(graph),
    version,
    revision: (p.revision ?? 0) + 1,
    updated_at: new Date(),
  });
  await markOlderRuns(procedureId, version);
}
