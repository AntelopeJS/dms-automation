import { HTTPResult } from "@antelopejs/interface-api";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { instanceId } from "../cluster/instance";
import { ProcedureModel } from "../db/models/procedure.model";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import type { Procedure } from "../db/tables/procedure.table";
import type { ProcedureRun } from "../db/tables/procedure_run.table";
import { RUNS_TOPIC, notifyTopic } from "../realtime";
import { DATABASE_NAME } from "../types/constants";
import type { GraphNode, ProcedureGraph } from "../types/graph";
import type { LogEntry, RunKind } from "../types/runLog";
import {
  boundRunLog,
  redactedStoredRun,
  scrubSecrets,
  secretsOf,
  serializeTriggerPayload,
} from "./boundRunLog";
import { MANUAL_TRIGGER_ID } from "./builtins/triggers/manual";
import {
  parseGraphSafe,
  stepName,
  stepNamesOf,
  summarizeTrigger,
} from "./describe";
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
  // A step may have copied a credential the trigger received (a header, a
  // query parameter) into its inputs, output or message: none is stored.
  const secrets = secretsOf(triggerPayload);
  const row: Partial<ProcedureRun> = {
    procedureId,
    procedureName,
    startedAt,
    endedAt,
    status: result.status,
    errorMessage: scrubSecrets(result.errorMessage, secrets),
    triggerNodeId,
    triggerPayload: serializeTriggerPayload(triggerPayload),
    logs: boundRunLog(scrubSecrets(result.logs, secrets)),
    kind: origin.kind,
    instanceId,
    stepNames: stepNamesOf(graph),
  };
  // A test runs a draft: no saved version, and its graph is kept nowhere else.
  if (origin.kind === "test") row.graphSnapshot = JSON.stringify(graph);
  else row.procedureVersion = procedureVersion;
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
  const runId = await insertRun(row);
  notifyTopic(RUNS_TOPIC, "run", { runId, procedureId });
  return runId;
}

/**
 * Store a run. A run the database refuses (a document over its size limit)
 * is stored again with its log replaced by a notice, so it still shows up
 * with its outcome.
 */
async function insertRun(row: Partial<ProcedureRun>): Promise<string> {
  const runModel = GetModel(ProcedureRunModel, DATABASE_NAME);
  try {
    return (await runModel.insert(row))[0] ?? "";
  } catch (err) {
    Logging.Error("[dms-automation] could not store a run in full:", err);
    const rootFire = row.logs?.fires.find((f) => f.parentFireId === null);
    const notice: LogEntry = {
      fireId: rootFire?.id ?? "",
      ts: 0,
      seq: 0,
      level: "warn",
      source: "exec",
      message: `log not stored: ${err instanceof Error ? err.message : String(err)}`,
    };
    const { graphSnapshot: _snapshot, ...rest } = row;
    const ids = await runModel.insert({
      ...rest,
      logs: {
        fires: rootFire ? [rootFire] : [],
        entries: [notice],
        truncated: row.logs?.entries.length ?? 0,
      },
    });
    return ids[0] ?? "";
  }
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
 * Bring the stored runs up to date at boot, in the background: every
 * procedure's current name on its runs (runs stored before the name was kept
 * on them, a rename made by another instance while this one was down), the
 * kind, duration and trigger of runs stored before runs kept them, the
 * current version on the runs of an older one, and the credentials (headers,
 * query parameters, their copies in the log) of runs stored before they were
 * redacted. Each step only touches the runs it changes, so a boot with
 * nothing to catch up writes nothing.
 */
export async function syncRunNames(): Promise<void> {
  try {
    const procedures = await GetModel(ProcedureModel, DATABASE_NAME).getAll();
    const runs = GetModel(ProcedureRunModel, DATABASE_NAME);
    for (const p of procedures) {
      await runs.renameProcedure(p._id, p.name);
      await runs.markOlderVersions(p._id, p.version ?? 1);
    }
    await completeLegacyRuns(runs, procedures);
    await redactStoredPayloads(runs);
  } catch (err) {
    Logging.Warn("[dms-automation] could not sync stored runs:", err);
  }
}

async function completeLegacyRuns(
  runs: ProcedureRunModel,
  procedures: Procedure[],
): Promise<void> {
  const graphs = new Map(
    procedures.map((p) => [p._id, parseGraphSafe(p.graph)]),
  );
  for (const run of await runs.listLegacy()) {
    const update: Partial<ProcedureRun> = { kind: "run" };
    if (run.durationMs === undefined && run.endedAt) {
      update.durationMs =
        new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    }
    const trigger = graphs
      .get(run.procedureId)
      ?.nodes.find((n) => n.id === run.triggerNodeId);
    if (!run.triggerSummary && trigger) {
      update.triggerSummary = summarizeTrigger(trigger);
      update.triggerType = update.triggerSummary.typeId;
    }
    await runs.update(run._id, update);
  }
}

async function redactStoredPayloads(runs: ProcedureRunModel): Promise<void> {
  for (const { _id } of await runs.listWithClearCredentials()) {
    const run = await runs.get(_id);
    const rewritten = run && redactedStoredRun(run);
    if (rewritten) await runs.update(_id, rewritten);
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
