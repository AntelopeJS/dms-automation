import { GetModel } from "@antelopejs/interface-database-decorators";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import { readTriggerPayload } from "../runtime/boundRunLog";
import { DATABASE_NAME } from "../types/constants";
import { API_MESSAGES } from "./requests";

// How many production runs Run now looks back through for a payload it kept.
const PAYLOAD_LOOKBACK = 50;

/**
 * The payload of the last production run that started from a trigger and
 * kept it. `tooLarge` tells that a newer call was too big to be kept.
 */
export async function lastPayloadOf(
  procedureId: string,
  triggerNodeId?: string,
) {
  const model = GetModel(ProcedureRunModel, DATABASE_NAME);
  let before = new Date();
  let tooLarge = false;
  for (let i = 0; i < PAYLOAD_LOOKBACK; i++) {
    const summary = await model.newest(procedureId, { tests: false, before });
    if (!summary) break;
    before = new Date(summary.startedAt);
    if (triggerNodeId && summary.triggerNodeId !== triggerNodeId) continue;
    const run = await model.get(summary._id);
    const stored = readTriggerPayload(run?.triggerPayload);
    if (!stored.kept) {
      tooLarge = true;
      continue;
    }
    const last = {
      runId: summary._id,
      triggerNodeId: summary.triggerNodeId,
      startedAt: before.toISOString(),
      payload: stored.payload,
    };
    return { last, tooLarge };
  }
  return { last: null, tooLarge };
}

/**
 * How a run started from a route ended: its status, and a warning the
 * DMS shows in place of the success toast when it failed.
 */
export async function runOutcome(runId: string, warnOnFailure: boolean) {
  const run = await GetModel(ProcedureRunModel, DATABASE_NAME).get(runId);
  const status = run?.status ?? "ok";
  return status === "failed" && warnOnFailure
    ? { runId, status, warning: `${API_MESSAGES}.runFailed` }
    : { runId, status };
}
