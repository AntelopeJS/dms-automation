import { HTTPResult } from "@antelopejs/interface-api";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { instanceId } from "../cluster/instance";
import { ProcedureModel } from "../db/models/procedure.model";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import type { Procedure } from "../db/tables/procedure.table";
import type { ProcedureRun } from "../db/tables/procedure_run.table";
import { DATABASE_NAME } from "../types/constants";
import type { GraphNode, ProcedureGraph } from "../types/graph";
import type { RunKind } from "../types/runLog";
import { boundRunLog, serializeTriggerPayload } from "./boundRunLog";
import { MANUAL_TRIGGER_ID } from "./builtins/triggers/manual";
import { stepName, summarizeTrigger } from "./describe";
import type { ExecutionResult } from "./executionResult";
import { run as executorRun } from "./executor";
import type { TemplateCache } from "./resolveSubgraph";

// Running a procedure and keeping its run: what the triggers, Run now,
// Re-run and Test run share.

interface RunRecord {
  graph: ProcedureGraph;
  procedureId: string;
  procedureName: string;
  triggerNodeId: string;
  triggerPayload: unknown;
  startedAt: Date;
  endedAt: Date;
  result: ExecutionResult;
  origin: RunOrigin;
  procedureVersion: number;
}

/** What asked for a run, beyond the trigger that seeds it. */
export interface RunOrigin {
  kind: RunKind;
  /** The run a `rerun` replays. */
  rerunOf?: string;
}

const TRIGGERED_RUN: RunOrigin = { kind: "run" };

async function writeRun({
  graph,
  procedureId,
  procedureName,
  triggerNodeId,
  triggerPayload,
  startedAt,
  endedAt,
  result,
  origin,
  procedureVersion,
}: RunRecord): Promise<string> {
  const runModel = GetModel(ProcedureRunModel, DATABASE_NAME);
  const row: Partial<ProcedureRun> = {
    procedureId,
    procedureName,
    startedAt,
    endedAt,
    status: result.status,
    errorMessage: result.errorMessage,
    triggerNodeId,
    triggerPayload: serializeTriggerPayload(triggerPayload),
    logs: boundRunLog(result.logs),
    kind: origin.kind,
    instanceId,
    procedureVersion,
  };
  row.durationMs = endedAt.getTime() - startedAt.getTime();
  const trigger = graph.nodes.find((n) => n.id === triggerNodeId);
  if (trigger) {
    row.triggerSummary = summarizeTrigger(trigger);
    row.triggerType = row.triggerSummary.typeId;
  }
  if (result.failedNodeId) {
    row.failedNodeId = result.failedNodeId;
    row.failedStep = stepName(graph, result.failedNodeId);
  }
  if (origin.rerunOf) row.rerunOf = origin.rerunOf;
  const ids = await runModel.insert(row);
  return ids[0] ?? "";
}

/** Run a graph from one of its triggers and store the run; returns its id. */
// The run's inputs come one per argument, as every caller has them.
// oxlint-disable-next-line eslint/max-params
export async function executeProcedure(
  procedure: Procedure,
  graph: ProcedureGraph,
  triggerNodeId: string,
  payload: unknown,
  templates: TemplateCache,
  origin: RunOrigin = TRIGGERED_RUN,
): Promise<string> {
  const procedureId = procedure._id;
  const startedAt = new Date();
  const result = await executorRun(graph, triggerNodeId, payload, {
    procedureId,
    templateCache: templates,
  });
  const endedAt = new Date();
  return await writeRun({
    graph,
    procedureId,
    procedureName: procedure.name,
    triggerNodeId,
    triggerPayload: payload,
    startedAt,
    endedAt,
    result,
    origin,
    procedureVersion: procedure.version ?? 1,
  });
}

/**
 * Write every procedure's current name on its runs: runs stored before the
 * name was kept on them get it, and a rename made by another instance while
 * this one was down is caught up. Runs in the background at boot.
 */
export async function syncRunNames(): Promise<void> {
  try {
    const procedures = await GetModel(ProcedureModel, DATABASE_NAME).getAll();
    const runs = GetModel(ProcedureRunModel, DATABASE_NAME);
    for (const p of procedures) await runs.renameProcedure(p._id, p.name);
  } catch (err) {
    Logging.Warn("[dms-automation] could not sync run procedure names:", err);
  }
}

/** A trigger of the graph: the one named, else the manual one, else the first. */
export function findTriggerNode(
  graph: ProcedureGraph,
  triggerNodeId?: string,
): GraphNode | undefined {
  const triggers = graph.nodes.filter((n) => n.kind === "trigger");
  if (triggerNodeId) return triggers.find((n) => n.id === triggerNodeId);
  return triggers.find((n) => n.typeId === MANUAL_TRIGGER_ID) ?? triggers.at(0);
}

export async function loadProcedure(procedureId: string): Promise<Procedure> {
  const procedure = await GetModel(ProcedureModel, DATABASE_NAME).get(
    procedureId,
  );
  if (!procedure) {
    throw new HTTPResult(404, {
      error: `procedure "${procedureId}" not found`,
    });
  }
  return procedure;
}

export function parseStoredGraph(procedure: Procedure): ProcedureGraph {
  try {
    return JSON.parse(procedure.graph) as ProcedureGraph;
  } catch {
    throw new HTTPResult(400, {
      error: `procedure "${procedure._id}" has an invalid graph`,
    });
  }
}
