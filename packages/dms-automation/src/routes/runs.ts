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
import type { ConfirmDialogImpact } from "@antelopejs/interface-dms/base";
import type { BannerContent } from "@antelopejs/interface-dms/base/banner";
import { serializeConfirmDialog } from "@antelopejs/interface-dms/base/confirm-dialog";
import { ProcedureModel } from "../db/models/procedure.model";
import {
  ProcedureRunModel,
  type RunSummary,
} from "../db/models/procedure_run.model";
import type { Procedure } from "../db/tables/procedure.table";
import type { ProcedureRun } from "../db/tables/procedure_run.table";
import { RUNS_URL } from "../pages/shared";
import {
  REDACTED,
  readTriggerPayload,
  redactedStoredRun,
} from "../runtime/boundRunLog";
import { parseGraphSafe } from "../runtime/describe";
import { subscriptions } from "../runtime/subscriptions";
import { stepDurations, traceOf } from "../runtime/trace";
import { triggerText } from "../runtime/wording";
import { DATABASE_NAME, MS_PER_DAY } from "../types/constants";
import type { DataValue } from "../types/dataValue";
import type { ProcedureGraph } from "../types/graph";
import type { RunLog } from "../types/runLog";
import { refused } from "./requests";
import { kpiAnswer } from "./stats";
import { isObject } from "../types/guards";

/** Time on each side of a run its usual duration is read over. */
const USUAL_DURATION_WINDOW_MS = 7 * MS_PER_DAY;

/** Successful runs averaged, at most, for the usual duration. */
const USUAL_DURATION_RUNS = 200;

/** A run compared with: its id, when, and how long each step took. */
interface RunRef {
  runId: string;
  startedAt: string;
  durationMs: number;
  stepDurations: Record<string, number | null>;
}

/** The graph a run is read against, and whether it is not the one that ran. */
interface RunGraph {
  graph?: ProcedureGraph;
  outdated: boolean;
}

/**
 * The graph a run executed, as far as it is known: the draft a test run
 * kept, else the procedure's graph, `outdated` when that one may not be the
 * graph that ran (a test without its draft, an older or unknown version). The
 * trace then reads nothing from its shape.
 */
function graphOf(
  run: ProcedureRun,
  procedure: Procedure | undefined,
): RunGraph {
  const snapshot = run.graphSnapshot
    ? parseGraphSafe(run.graphSnapshot)
    : undefined;
  if (snapshot) return { graph: snapshot, outdated: false };
  const graph = procedure ? parseGraphSafe(procedure.graph) : undefined;
  if (!graph || !procedure) return { graph, outdated: false };
  const olderVersion = (run.procedureVersion ?? 0) < procedure.version;
  return { graph, outdated: run.kind === "test" || olderVersion };
}

/** A run's trace, from the graph that ran and the step names it kept. */
function runTrace(
  run: ProcedureRun,
  procedure: Procedure | undefined,
  payload: DataValue,
) {
  const { graph, outdated } = graphOf(run, procedure);
  const trace = traceOf(
    graph,
    run.logs,
    { nodeId: run.triggerNodeId, payload },
    { outdated, names: run.stepNames },
  );
  return { graph, outdated, trace };
}

function runRef(run: ProcedureRun, procedure: Procedure | undefined): RunRef {
  return {
    runId: run._id,
    startedAt: new Date(run.startedAt).toISOString(),
    durationMs: run.durationMs,
    stepDurations: stepDurations(runTrace(run, procedure, null).trace.steps),
  };
}

/** The reads of the run history a trace compares with. */
type HistoryModel = Pick<
  ProcedureRunModel,
  "get" | "newest" | "oldest" | "countHistory" | "successTimings"
>;

/** A run next to the one a trace shows: the previous one, or the next. */
function neighbourOf(run: RunSummary | undefined) {
  return run
    ? {
        runId: run._id,
        startedAt: new Date(run.startedAt).toISOString(),
        status: run.status,
        errorMessage: run.errorMessage ?? "",
      }
    : null;
}

/**
 * The runs of the same procedure a run is compared with, however far back:
 * the last success and the run before it, the run after it, the failures in
 * a row it ends, and how long a success takes around its date. A test is
 * compared with the tests, which run drafts, and a production run with the
 * production runs: a broken draft says nothing of the saved procedure.
 *
 * This failure and the ones since the last success.
 */
export async function historyOf(
  run: ProcedureRun,
  model: HistoryModel = GetModel(ProcedureRunModel, DATABASE_NAME),
) {
  const startedAt = new Date(run.startedAt);
  const tests = run.kind === "test";
  const [lastSuccessSummary, previous, next, timings] = await Promise.all([
    model.newest(run.procedureId, { tests, before: startedAt, status: "ok" }),
    model.newest(run.procedureId, { tests, before: startedAt }),
    model.oldest(run.procedureId, { tests, after: startedAt }),
    model.successTimings(
      run.procedureId,
      {
        tests,
        after: new Date(startedAt.getTime() - USUAL_DURATION_WINDOW_MS),
        before: new Date(startedAt.getTime() + USUAL_DURATION_WINDOW_MS),
      },
      USUAL_DURATION_RUNS,
    ),
  ]);
  const durations = timings
    .filter((r) => r._id !== run._id)
    .map((r) => r.durationMs);
  const lastSuccess = lastSuccessSummary
    ? await model.get(lastSuccessSummary._id)
    : undefined;
  const failuresInRow =
    run.status === "failed"
      ? 1 +
        (await model.countHistory(run.procedureId, {
          tests,
          after: lastSuccess ? new Date(lastSuccess.startedAt) : undefined,
          before: startedAt,
          status: "failed",
        }))
      : 0;
  return {
    usualDurationMs: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
    lastSuccess,
    previous: neighbourOf(previous),
    next: neighbourOf(next),
    failuresInRow,
  };
}

async function loadRun(id: string): Promise<ProcedureRun> {
  const run = await GetModel(ProcedureRunModel, DATABASE_NAME).get(id);
  if (!run) throw new HTTPResult(404, { error: `run "${id}" not found` });
  return run;
}

/**
 * A run as it is shown: a run stored before the project marked a name as
 * sensitive (`runs.sensitiveNames`) has that credential redacted from its
 * payload and scrubbed from its log on read.
 */
function shown(run: ProcedureRun): ProcedureRun {
  return Object.assign({}, run, redactedStoredRun(run));
}

/**
 * The headers and query parameters a stored payload names without their
 * value (see REDACTED).
 */
function redactedNamesOf(payload: DataValue): string[] {
  if (!isObject(payload)) return [];
  const headers = "headers" in payload ? payload.headers : undefined;
  const query = "query" in payload ? payload.query : undefined;
  return [headers, query].flatMap((group) =>
    isObject(group)
      ? Object.entries(group)
          .filter(([, value]) => value === REDACTED)
          .map(([name]) => name)
      : [],
  );
}

/** A re-run of the same run asked again this soon is refused: a double click. */
const RERUN_COOLDOWN_MS = 5000;

/** The re-runs in progress or just started, by the run they replay. */
const recentReruns = new Map<string, { running: boolean; startedAt: number }>();

/**
 * Take the right to re-run a run, refused while it is being re-run or was
 * re-run a moment ago. Per instance: two instances may each run one.
 */
export function claimRerun(runId: string): () => void {
  const recent = recentReruns.get(runId);
  if (
    recent &&
    (recent.running || Date.now() - recent.startedAt < RERUN_COOLDOWN_MS)
  ) {
    throw refused(
      409,
      "this run is being re-run already",
      "$dms_automation.runs.rerunBusy",
    );
  }
  const claim = { running: true, startedAt: Date.now() };
  recentReruns.set(runId, claim);
  return () => {
    claim.running = false;
    const left = claim.startedAt + RERUN_COOLDOWN_MS - Date.now();
    setTimeout(
      () => {
        if (recentReruns.get(runId) === claim) recentReruns.delete(runId);
      },
      Math.max(0, left),
    ).unref();
  };
}

/** What re-running a run takes, or why it cannot be re-run. */
type RerunPlan =
  | { blocked: string; status: number }
  | {
      blocked?: undefined;
      procedure: Procedure;
      payload: DataValue;
      /** The draft a test run executed, run again as a test. */
      draft?: ProcedureGraph;
    };

async function rerunPlanOf(run: ProcedureRun): Promise<RerunPlan> {
  const procedure = await GetModel(ProcedureModel, DATABASE_NAME).get(
    run.procedureId,
  );
  return rerunPlanFor(run, procedure);
}

/** What re-running `run` of `procedure` (absent when deleted) takes. */
export function rerunPlanFor(
  run: ProcedureRun,
  procedure: Procedure | undefined,
): RerunPlan {
  if (!procedure) {
    return {
      blocked: "$dms_automation.runs.rerunBlocked.deleted",
      status: 404,
    };
  }
  const payload = readTriggerPayload(run.triggerPayload);
  if (!payload.kept) {
    return {
      blocked: "$dms_automation.runs.rerunBlocked.payloadTooLarge",
      status: 409,
    };
  }
  if (run.kind === "test") {
    const draft = run.graphSnapshot
      ? parseGraphSafe(run.graphSnapshot)
      : undefined;
    if (!draft) {
      return {
        blocked: "$dms_automation.runs.rerunBlocked.draftNotKept",
        status: 409,
      };
    }
    return { procedure, payload: payload.payload, draft };
  }
  const graph = parseGraphSafe(procedure.graph);
  if (!graph?.nodes.some((n) => n.id === run.triggerNodeId)) {
    return {
      blocked: "$dms_automation.runs.rerunBlocked.triggerGone",
      status: 409,
    };
  }
  return { procedure, payload: payload.payload };
}

@AuthOwnerOnly()
export class RunsController extends Controller("/api/automation/runs") {
  @Get("/kpi/:metric")
  // oxlint-disable-next-line eslint/max-params -- one decorator per query input
  async kpi(
    @AuthRawUser() _user: User,
    @Parameter("metric", "param") metric: string,
    @Parameter("from", "query") from?: string,
    @Parameter("to", "query") to?: string,
    @Parameter("compareFrom", "query") compareFrom?: string,
    @Parameter("compareTo", "query") compareTo?: string,
    @Parameter("preset", "query") preset?: string,
    @Parameter("comparison", "query") comparison?: string,
  ) {
    return kpiAnswer(metric, {
      from,
      to,
      compareFrom,
      compareTo,
      preset,
      comparison,
    });
  }

  /**
   * The banner of Run history opened on one procedure (`?procedure=<id>`,
   * the "View runs" links): whose runs the list shows, and the way back to
   * every run. No banner without a procedure.
   *
   * An empty `?procedure=` filters nothing, so the banner says nothing.
   *
   * A deleted procedure is still named by its runs.
   *
   * The KPIs read every run: their cards cannot take the page's filter.
   */
  @Get("/scope/banner")
  async scopeBanner(
    @AuthRawUser() _user: User,
    @Parameter("procedure", "query") procedureParam?: string,
  ): Promise<BannerContent> {
    const procedureId = procedureParam?.trim();
    if (!procedureId) return {};
    const procedure = await GetModel(ProcedureModel, DATABASE_NAME).get(
      procedureId,
    );
    const [run] = procedure
      ? []
      : await GetModel(ProcedureRunModel, DATABASE_NAME).listByProcedure(
          procedureId,
          0,
          1,
        );
    const name = procedure?.name ?? run?.procedureName;
    return {
      title: name
        ? { key: "dms_automation.runs.scopedTo", params: { name } }
        : "$dms_automation.runs.scopedToMissing",
      description: "$dms_automation.runs.scopedKpis",
      tone: "info",
      size: "sm",
      icon: "i-ph-funnel",
      actions: [
        {
          label: "$dms_automation.runs.showAllRuns",
          to: RUNS_URL,
          icon: "i-ph-x",
          variant: "ghost",
        },
      ],
    };
  }

  /**
   * One run with everything its trace shows: the steps read from its log,
   * the steps it skipped, the graph that ran (or the procedure's, flagged
   * `graphOutdated` when it is not that one), and the runs it is compared
   * with (the last success, the previous run). Its log is read from
   * `/:id/logs`.
   *
   * The stored run, as a plain object, without what is served elsewhere
   * (the log) or only read here (the draft, the step names).
   *
   * A test ran a draft, not a saved version.
   */
  @Get("/:id")
  async getOne(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const run = shown(await loadRun(id));
    const procedure = await GetModel(ProcedureModel, DATABASE_NAME).get(
      run.procedureId,
    );
    const payload = readTriggerPayload(run.triggerPayload);
    const { graph, outdated, trace } = runTrace(
      run,
      procedure,
      payload.kept ? payload.payload : null,
    );
    const history = await historyOf(run);
    const {
      logs,
      graphSnapshot: _snapshot,
      stepNames: _names,
      ...stored
    } = run;
    return Object.assign(stored, {
      procedureVersion: run.kind === "test" ? null : run.procedureVersion,
      logCount: logs?.entries.length ?? 0,
      logTruncated: logs?.truncated,
      payloadKept: payload.kept,
      procedure: procedure
        ? {
            _id: procedure._id,
            name: procedure.name,
            enabled: procedure.enabled,
            version: procedure.version,
          }
        : null,
      graph: graph ?? null,
      graphOutdated: outdated,
      trigger: run.triggerSummary ?? null,
      triggerText: triggerText(run.triggerSummary),
      failedStep: run.failedStep ?? null,
      trace,
      usualDurationMs: history.usualDurationMs,
      lastSuccess: history.lastSuccess
        ? runRef(history.lastSuccess, procedure)
        : null,
      previous: history.previous,
      next: history.next,
      failuresInRow: history.failuresInRow,
    });
  }

  /** The log of a run as it is stored: its fire tree and its entries. */
  @Get("/:id/logs")
  async logs(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ): Promise<RunLog> {
    const run = shown(await loadRun(id));
    return run.logs ?? { fires: [], entries: [] };
  }

  /**
   * The confirmation of Re-run, worded for the run: what runs again (the
   * saved procedure, or the draft a test ran), what differs from the first
   * time (a paused procedure, headers whose value was not kept), or why it
   * cannot be re-run.
   *
   * A test acts for real through these steps: named before it runs again.
   */
  @Get("/:id/rerun-confirm")
  async rerunConfirm(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const plan = await rerunPlanOf(await loadRun(id));
    if (plan.blocked !== undefined) {
      return serializeConfirmDialog({
        title: "$dms_automation.runs.rerunBlockedTitle",
        description: plan.blocked,
        icon: "i-ph-prohibit",
        color: "neutral",
        blocked: true,
      });
    }
    const isTest = plan.draft !== undefined;
    const headers = redactedNamesOf(plan.payload);
    const impact: ConfirmDialogImpact[] = [];
    if (!isTest && !plan.procedure.enabled) {
      impact.push({
        icon: "i-ph-pause-circle",
        label: "$dms_automation.runs.rerunPaused",
      });
    }
    if (headers.length > 0) {
      impact.push({
        icon: "i-ph-eye-slash",
        label: "$dms_automation.runs.rerunRedacted",
      });
    }
    for (const step of plan.draft
      ? subscriptions.realEffectsOf(plan.draft)
      : []) {
      const line: ConfirmDialogImpact = {
        icon: "i-ph-lightning",
        label: step.typeName,
      };
      if (step.label) line.count = step.label;
      impact.push(line);
    }
    return serializeConfirmDialog({
      title: isTest
        ? "$dms_automation.runs.retestConfirmTitle"
        : "$dms_automation.runs.rerunConfirmTitle",
      description: isTest
        ? "$dms_automation.runs.retestConfirmDescription"
        : "$dms_automation.runs.rerunConfirmDescription",
      params: { name: plan.procedure.name, headers: headers.join(", ") },
      icon: isTest ? "i-ph-flask" : "i-ph-arrow-clockwise",
      color: "warning",
      confirmLabel: isTest
        ? "$dms_automation.runs.retest"
        : "$dms_automation.runs.rerun",
      impact,
    });
  }

  /**
   * Re-run with this payload: the procedure's saved graph, from the trigger
   * that started this run, with the payload it received (its secret headers
   * redacted). A test run runs the draft it tested again, as a test. Answers
   * the new run, with a warning when it failed.
   */
  @Post("/:id/rerun")
  async rerun(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const run = await loadRun(id);
    const plan = await rerunPlanOf(run);
    if (plan.blocked !== undefined) {
      throw new HTTPResult(plan.status, {
        error: "this run cannot be re-run",
        message: plan.blocked,
      });
    }
    const release = claimRerun(run._id);
    let runId: string;
    try {
      runId = plan.draft
        ? await subscriptions.testRun(
            run.procedureId,
            plan.draft,
            plan.payload,
            run.triggerNodeId,
          )
        : await subscriptions.rerun(run.procedureId, {
            _id: run._id,
            triggerNodeId: run.triggerNodeId,
            triggerPayload: plan.payload,
          });
    } finally {
      release();
    }
    const { status } = await loadRun(runId);
    return status === "failed"
      ? { runId, status, warning: "$dms_automation.runs.rerunFailed" }
      : { runId, status };
  }
}
