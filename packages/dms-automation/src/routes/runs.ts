import {
  Controller,
  Get,
  HTTPResult,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { ProcedureModel } from "../db/models/procedure.model";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import type { ProcedureRun } from "../db/tables/procedure_run.table";
import { readTriggerPayload } from "../runtime/boundRunLog";
import {
  parseGraphSafe,
  stepName,
  summarizeTrigger,
} from "../runtime/describe";
import { subscriptions } from "../runtime/subscriptions";
import { traceOf } from "../runtime/trace";
import { durationOf } from "../stats/health";
import { DATABASE_NAME, MS_PER_DAY, MS_PER_HOUR } from "../types/constants";
import type { ProcedureGraph } from "../types/graph";
import { isProductionRun } from "../types/runLog";
import { kpiAnswer } from "./stats";

// Period unit ("h" / "d") to its span in milliseconds.
const MS_PER_UNIT: Record<"h" | "d", number> = {
  h: MS_PER_HOUR,
  d: MS_PER_DAY,
};

function sinceFromPeriod(period?: string): Date | undefined {
  if (!period) return undefined;
  const m = /^(\d+)([hd])$/.exec(period);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2] as "h" | "d";
  return new Date(Date.now() - n * MS_PER_UNIT[unit]);
}

/** Runs of the same procedure read to compare a run with. */
const HISTORY_RUNS = 50;

/** A run compared with: its id, when, and how long each step took. */
interface RunRef {
  runId: string;
  startedAt: string;
  durationMs: number | null;
  stepDurations: Record<string, number | null>;
}

function runRef(run: ProcedureRun, graph?: ProcedureGraph): RunRef {
  const durations: Record<string, number | null> = {};
  for (const step of traceOf(graph, run.logs).steps) {
    if (!(step.nodeId in durations)) durations[step.nodeId] = step.durationMs;
  }
  return {
    runId: run._id,
    startedAt: new Date(run.startedAt).toISOString(),
    durationMs: durationOf(run),
    stepDurations: durations,
  };
}

/** The runs of one procedure around a run: the history a trace compares to. */
async function historyOf(run: ProcedureRun) {
  const model = GetModel(ProcedureRunModel, DATABASE_NAME);
  const recent = (
    await model.listByProcedure(run.procedureId, 0, HISTORY_RUNS)
  ).filter((r) => isProductionRun(r.kind) && r._id !== run._id);
  const before = recent.filter(
    (r) => new Date(r.startedAt).getTime() < new Date(run.startedAt).getTime(),
  );
  const ok = recent.filter((r) => r.status === "ok");
  const durations = ok
    .map((r) => durationOf(r))
    .filter((d): d is number => d !== null);
  const lastSuccessSummary = before.find((r) => r.status === "ok");
  const lastSuccess = lastSuccessSummary
    ? await model.get(lastSuccessSummary._id)
    : undefined;
  const previous = before[0];
  let failuresInRow = run.status === "failed" ? 1 : 0;
  if (run.status === "failed") {
    for (const r of before) {
      if (r.status !== "failed") break;
      failuresInRow += 1;
    }
  }
  return {
    usualDurationMs: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
    lastSuccess,
    previous: previous
      ? {
          runId: previous._id,
          startedAt: new Date(previous.startedAt).toISOString(),
          status: previous.status,
          errorMessage: previous.errorMessage ?? "",
        }
      : null,
    failuresInRow,
  };
}

async function loadRun(id: string): Promise<ProcedureRun> {
  const run = await GetModel(ProcedureRunModel, DATABASE_NAME).get(id);
  if (!run) throw new HTTPResult(404, { error: `run "${id}" not found` });
  return run;
}

@AuthOwnerOnly()
export class RunsController extends Controller("/api/automation/runs") {
  @Get("")
  // Each parameter is bound to a request input by its decorator, so
  // the framework hands them in positionally: an options object is not
  // expressible here.
  // oxlint-disable-next-line eslint/max-params
  async list(
    @AuthRawUser() _user: User,
    @Parameter("page", "query") page?: string,
    @Parameter("limit", "query") limit?: string,
    @Parameter("procedureId", "query") procedureId?: string,
    @Parameter("status", "query") status?: string,
    @Parameter("period", "query") period?: string,
  ) {
    const model = GetModel(ProcedureRunModel, DATABASE_NAME);
    const normalizedStatus =
      status === "ok" || status === "failed" ? status : undefined;
    return model.listAll({
      page: parseInt(page ?? "0", 10),
      limit: parseInt(limit ?? "50", 10),
      procedureId,
      status: normalizedStatus,
      since: sinceFromPeriod(period),
      // Over-fetch one row so the client can tell whether a next page exists.
      peek: true,
    });
  }

  @Get("/kpi/:metric")
  // oxlint-disable-next-line eslint/max-params -- one decorator per query input
  async kpi(
    @AuthRawUser() _user: User,
    @Parameter("metric", "param") metric: string,
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
    @Parameter("compareFrom", "query") compareFrom?: string,
    @Parameter("compareTo", "query") compareTo?: string,
  ) {
    return kpiAnswer(metric, { from, to, compareFrom, compareTo });
  }

  /**
   * One run with everything its trace shows: the steps read from its log,
   * the steps it skipped, the procedure as it is now, and the runs it is
   * compared with (the last success, the previous run).
   */
  @Get("/:id")
  async getOne(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const run = await loadRun(id);
    const procedure = await GetModel(ProcedureModel, DATABASE_NAME).get(
      run.procedureId,
    );
    const graph = procedure ? parseGraphSafe(procedure.graph) : undefined;
    const trigger = graph?.nodes.find((n) => n.id === run.triggerNodeId);
    const history = await historyOf(run);
    const payload = readTriggerPayload(run.triggerPayload);
    // The stored run, as a plain object, with what the trace adds.
    return Object.assign({}, run, {
      durationMs: run.durationMs ?? durationOf(run),
      payloadKept: payload.kept,
      procedure: procedure
        ? {
            _id: procedure._id,
            name: procedure.name,
            enabled: procedure.enabled,
            version: procedure.version ?? 1,
          }
        : null,
      graph: graph ?? null,
      trigger:
        run.triggerSummary ?? (trigger ? summarizeTrigger(trigger) : null),
      failedStep:
        run.failedStep ??
        (run.failedNodeId && graph ? stepName(graph, run.failedNodeId) : null),
      trace: traceOf(graph, run.logs, {
        nodeId: run.triggerNodeId,
        payload: payload.kept ? payload.payload : null,
      }),
      usualDurationMs: history.usualDurationMs,
      lastSuccess: history.lastSuccess
        ? runRef(history.lastSuccess, graph)
        : null,
      previous: history.previous,
      failuresInRow: history.failuresInRow,
    });
  }

  /**
   * Re-run with this payload: the procedure's saved graph, from the trigger
   * that started this run, with the payload it received.
   */
  @Post("/:id/rerun")
  async rerun(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const run = await loadRun(id);
    const payload = readTriggerPayload(run.triggerPayload);
    if (!payload.kept) {
      throw new HTTPResult(409, {
        error: `the payload of this run was too large to keep (${payload.originalBytes} bytes), so it cannot be re-run`,
      });
    }
    const runId = await subscriptions.rerun(run.procedureId, {
      _id: run._id,
      triggerNodeId: run.triggerNodeId,
      triggerPayload: payload.payload,
    });
    return { runId };
  }
}
