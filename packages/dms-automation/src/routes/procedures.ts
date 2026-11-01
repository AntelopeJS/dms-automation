import { randomUUID } from "node:crypto";
import {
  Controller,
  Delete,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
  Put,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { serializeConfirmDialog } from "@antelopejs/interface-dms/base/confirm-dialog";
import { ProcedureModel } from "../db/models/procedure.model";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import { getProceduresSummary } from "../db/models/stats.model";
import type { Procedure } from "../db/tables/procedure.table";
import { PROCEDURES_TOPIC, notifyTopic } from "../realtime";
import { DEFAULT_SCHEDULE } from "../runtime/builtins/triggers/cron";
import { parseGraphSafe, triggersOf } from "../runtime/describe";
import { hasBlockingIssue } from "../runtime/graphIssues";
import { changesExecution } from "../runtime/graphVersion";
import { nextOccurrence } from "../runtime/schedule";
import { subscriptions } from "../runtime/subscriptions";
import { withFreeWebhookPaths } from "../runtime/webhookRoutes";
import { withTriggerText } from "../runtime/wording";
import { DATABASE_NAME, MS_PER_DAY } from "../types/constants";
import {
  type GraphNode,
  parseGraph,
  type ProcedureGraph,
} from "../types/graph";
import { isProductionRun } from "../types/runLog";
import { deleteDialogOf } from "./deleteConfirm";
import {
  checkSavable,
  graphRefusal,
  issuesOf,
  nameWarning,
  saveIssues,
  stale,
} from "./procedureChecks";
import { lastPayloadOf, runNow, runOutcome } from "./procedureRuns";
import {
  enabledSchema,
  exportedSchema,
  importErrorOf,
  importSchema,
  MAX_NAME_LENGTH,
  newProcedureSchema,
  procedureUpdateSchema,
  runNowSchema,
  type Starter,
  testEffectsSchema,
  testSchema,
  validateSchema,
} from "./procedureSchemas";
import {
  API_MESSAGES as API,
  pageParams,
  parseBody,
  refused,
} from "./requests";
import type { DataRecord, DataValue } from "../types/dataValue";

async function loadProcedure(id: string): Promise<Procedure> {
  const procedure = await GetModel(ProcedureModel, DATABASE_NAME).get(id);
  if (!procedure) {
    throw refused(404, `procedure "${id}" not found`, `${API}.notFound`);
  }
  return procedure;
}

function graphOf(procedure: Procedure): ProcedureGraph {
  const graph = parseGraphSafe(procedure.graph);
  if (!graph) {
    throw refused(
      400,
      `procedure "${procedure._id}" has an invalid graph`,
      `${API}.graphHasErrors`,
    );
  }
  return graph;
}

function emptyGraph(): ProcedureGraph {
  return { nodes: [], triggerEdges: [], dataEdges: [] };
}

function newNodeId(): string {
  return `node_${randomUUID().slice(0, 8)}`;
}

const SLUG_INVALID = /[^a-z0-9]+/g;
const SLUG_EDGES = /^-+|-+$/g;
const MAX_SLUG_LENGTH = 40;

function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(SLUG_INVALID, "-")
    .replace(SLUG_EDGES, "")
    .slice(0, MAX_SLUG_LENGTH);
  return slug || "procedure";
}

const STARTER_CONFIG: Record<Starter, (name: string) => DataRecord> = {
  webhook: (name) => ({ path: `/webhooks/${slugOf(name)}`, method: "POST" }),
  "schedule.cron": () => ({ cron: DEFAULT_SCHEDULE }),
  manual: () => ({}),
};

/** A graph holding only the trigger picked in the "New procedure" dialog. */
function starterGraph(trigger: Starter, name: string): ProcedureGraph {
  const node: GraphNode = {
    id: newNodeId(),
    kind: "trigger",
    typeId: trigger,
    config: STARTER_CONFIG[trigger](name),
    position: { x: 80, y: 160 },
  };
  return { ...emptyGraph(), nodes: [node] };
}

/** Insert a disabled procedure and return its id. */
async function insertDraft(
  name: string,
  description: string,
  graph: ProcedureGraph,
): Promise<string> {
  const now = new Date();
  const ids = await GetModel(ProcedureModel, DATABASE_NAME).insert({
    name,
    description,
    enabled: false,
    graph: JSON.stringify(await withFreeWebhookPaths(graph)),
    version: 1,
    revision: 1,
    created_at: now,
    updated_at: now,
  });
  const id = ids[0];
  if (!id) {
    throw new HTTPResult(500, { error: "procedure insert returned no id" });
  }
  await subscriptions.onProcedureChange(id);
  notifyTopic(PROCEDURES_TOPIC, "created", { procedureId: id });
  return id;
}

/** A procedure as the API serves it: its graph parsed. */
function served(procedure: Procedure) {
  const { graph, ...fields } = procedure;
  return { ...fields, graph: parseGraph(graph) };
}

/** The name of a copy, kept within the length a name may have. */
function copyNameOf(name: string): string {
  const suffix = " (copy)";
  return `${name.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
}

/**
 * The triggers of a saved graph, each with its text and, for a schedule, the
 * next time it fires.
 */
export function savedTriggersOf(graph: ProcedureGraph, from = new Date()) {
  return triggersOf(graph).map((trigger) => ({
    ...withTriggerText(trigger),
    nextAt: trigger.cron
      ? (nextOccurrence(trigger.cron, from)?.toISOString() ?? null)
      : null,
  }));
}

@AuthOwnerOnly()
export class ProceduresController extends Controller(
  "/api/automation/procedures",
) {
  @Get("")
  async list(
    @AuthRawUser() _user: User,
    @Parameter("page", "query") page?: string,
    @Parameter("limit", "query") limit?: string,
  ) {
    const model = GetModel(ProcedureModel, DATABASE_NAME);
    const listed = await model.list(pageParams(page, limit));
    return { ...listed, results: listed.results.map(served) };
  }

  /**
   * Per-procedure rows (trigger, state, last runs, success, avg): the
   * builder's procedure switcher reads them. Declared before "/:id".
   */
  @Get("/summary")
  async summary(@AuthRawUser() _user: User) {
    return await getProceduresSummary();
  }

  /**
   * The problems of a draft graph, for the builder's Problems dock: as for an
   * enabled procedure when `enabled` is set (a missing setting then blocks).
   * With the procedure's id and name, a webhook path or a name another
   * procedure already uses is reported too. With the draft's triggers and
   * their text, for the canvas and the test dock.
   */
  @Post("/validate")
  async validate(@AuthRawUser() _user: User, @JSONBody() body: DataValue) {
    const { graph, enabled, procedureId, name } = parseBody(
      validateSchema,
      body,
    );
    const target = { procedureId, name };
    return {
      issues: await saveIssues(graph, enabled ?? false, target),
      triggers: triggersOf(graph).map(withTriggerText),
    };
  }

  /**
   * "New procedure": a disabled draft named by the user, with the trigger
   * they picked already placed. The dialog then opens the builder on it.
   */
  @Post("/new")
  async createFromStarter(
    @AuthRawUser() _user: User,
    @JSONBody() body: DataValue,
  ) {
    const data = parseBody(newProcedureSchema, body);
    const warning = await nameWarning(data.name);
    const id = await insertDraft(
      data.name,
      data.description ?? "",
      starterGraph(data.trigger, data.name),
    );
    return { _id: id, ...warning };
  }

  /**
   * "Import JSON": an exported procedure becomes a new disabled draft.
   *
   * No `issues` list: the DMS would map its paths onto form fields
   * before reading `field`, and the error would miss the JSON field.
   */
  @Post("/import")
  async importJson(@AuthRawUser() _user: User, @JSONBody() body: DataValue) {
    const { json } = parseBody(importSchema, body);
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new HTTPResult(400, {
        field: "json",
        message: "$dms_automation.importProcedure.notJson",
      });
    }
    const parsed = exportedSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HTTPResult(400, {
        field: "json",
        message: importErrorOf(parsed.error.issues),
      });
    }
    const warning = await nameWarning(parsed.data.name);
    const id = await insertDraft(
      parsed.data.name,
      parsed.data.description ?? "",
      parsed.data.graph,
    );
    return { _id: id, issues: issuesOf(parsed.data.graph, false), ...warning };
  }

  @Get("/:id")
  async getOne(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    return served(await loadProcedure(id));
  }

  /** The procedure as "Import JSON" reads it back. */
  @Get("/:id/export")
  async exportJson(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const procedure = await loadProcedure(id);
    return {
      name: procedure.name,
      description: procedure.description ?? "",
      graph: graphOf(procedure),
    };
  }

  /** "Duplicate": a disabled copy, its webhooks moved to free paths. */
  @Post("/:id/duplicate")
  async duplicate(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const procedure = await loadProcedure(id);
    const copyId = await insertDraft(
      copyNameOf(procedure.name),
      procedure.description ?? "",
      graphOf(procedure),
    );
    return { _id: copyId };
  }

  /**
   * Save a procedure. The save is refused (409 `stale`) when the procedure
   * was written since it was loaded at `expectedRevision`. The version moves
   * on only when the graph changes; the revision on every save.
   *
   * Moving or restyling nodes is a new revision, not a new version. A
   * procedure written by someone else between the read and this write is the
   * stale case above. The runs of the previous graph now read as an older
   * version.
   */
  @Put("/:id")
  async update(
    @AuthRawUser() user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: DataValue,
  ) {
    const data = parseBody(procedureUpdateSchema, body);
    const existing = await loadProcedure(id);
    if (existing.revision !== data.expectedRevision) throw stale(existing);
    const issues = await checkSavable(data.graph, data.enabled, {
      procedureId: id,
      name: data.name,
    });
    const graph = JSON.stringify(data.graph);
    const current = existing.version;
    const version = changesExecution(existing.graph, data.graph)
      ? current + 1
      : current;
    const revision = existing.revision + 1;
    const patch: Partial<Procedure> = {
      name: data.name,
      description: data.description ?? "",
      enabled: data.enabled,
      graph,
      version,
      revision,
      updated_at: new Date(),
    };
    if (existing.enabled && !data.enabled) {
      patch.pausedAt = new Date();
      patch.pausedBy = user.name ?? user.email;
    }
    const model = GetModel(ProcedureModel, DATABASE_NAME);
    if (!(await model.updateAtRevision(id, existing.revision, patch))) {
      throw stale(await loadProcedure(id));
    }
    const runs = GetModel(ProcedureRunModel, DATABASE_NAME);
    if (existing.name !== data.name) {
      await runs.renameProcedure(id, data.name);
    }
    if (version !== current) await runs.markOlderVersions(id, version);
    await subscriptions.onProcedureChange(id);
    notifyTopic(PROCEDURES_TOPIC, "updated", { procedureId: id });
    return { _id: id, version, revision, issues };
  }

  /**
   * Pause or resume a procedure without touching its graph.
   *
   * A new revision (the graph, and so the version, stays): a builder
   * still open on the old one cannot save it back over a pause or a resume.
   *
   * Undoing a resume puts the pause back as it was: a resume leaves its
   * time and author in place.
   */
  @Put("/:id/enabled")
  async setEnabled(
    @AuthRawUser() user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: DataValue,
  ) {
    const { enabled, restorePause } = parseBody(enabledSchema, body);
    const procedure = await loadProcedure(id);
    if (enabled) {
      await checkSavable(graphOf(procedure), true, { procedureId: id });
    }
    const patch: Partial<Procedure> = {
      enabled,
      revision: procedure.revision + 1,
      updated_at: new Date(),
    };
    if (!enabled && procedure.enabled && !restorePause) {
      patch.pausedAt = new Date();
      patch.pausedBy = user.name ?? user.email;
    }
    await GetModel(ProcedureModel, DATABASE_NAME).update(id, patch);
    await subscriptions.onProcedureChange(id);
    notifyTopic(PROCEDURES_TOPIC, enabled ? "enabled" : "disabled", {
      procedureId: id,
    });
    return { _id: id, enabled, revision: patch.revision };
  }

  /** Hide a degraded procedure from "Needs attention" until it fails again. */
  @Post("/:id/dismiss-attention")
  async dismissAttention(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    await loadProcedure(id);
    await GetModel(ProcedureModel, DATABASE_NAME).update(id, {
      attentionDismissedAt: new Date(),
    });
    notifyTopic(PROCEDURES_TOPIC, "updated", { procedureId: id });
    return { _id: id };
  }

  /** Undo a dismiss: the procedure is back in "Needs attention". */
  @Delete("/:id/dismiss-attention")
  async undoDismissAttention(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    await loadProcedure(id);
    await GetModel(ProcedureModel, DATABASE_NAME).update(id, {
      attentionDismissedAt: null,
    });
    notifyTopic(PROCEDURES_TOPIC, "updated", { procedureId: id });
    return { _id: id };
  }

  @Delete("/:id")
  async remove(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    await loadProcedure(id);
    await GetModel(ProcedureModel, DATABASE_NAME).delete(id);
    await subscriptions.onProcedureDelete(id);
    notifyTopic(PROCEDURES_TOPIC, "deleted", { procedureId: id });
    return { _id: id };
  }

  /** The delete dialog, worded for the procedure (see deleteDialogOf). */
  @Get("/:id/delete-confirm")
  async deleteConfirm(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const procedure = await loadProcedure(id);
    const since = new Date(Date.now() - 7 * MS_PER_DAY);
    const runs = (
      await GetModel(ProcedureRunModel, DATABASE_NAME).listForStats(since)
    ).filter((r) => r.procedureId === id && isProductionRun(r.kind));
    return serializeConfirmDialog(deleteDialogOf(procedure, runs.length));
  }

  /**
   * Run now (see `runNow`), what `RunProcedure` does from code. The answer
   * says how the run ended.
   */
  @Post("/:id/run-now")
  async runNow(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: DataValue,
  ) {
    const data = parseBody(runNowSchema, body) ?? {};
    const runId = await runNow(id, graphOf(await loadProcedure(id)), data);
    return await runOutcome(runId, true);
  }

  /**
   * Test run: execute a draft graph without saving it. The run is kept as a
   * `test` run so it has a trace, and never counts in the health figures.
   * Nothing runs until the user agreed to its real effects: the warning comes
   * before the run, never after.
   */
  @Post("/:id/test")
  async test(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: DataValue,
  ) {
    const data = parseBody(testSchema, body);
    const issues = issuesOf(data.graph, false);
    if (hasBlockingIssue(issues)) throw graphRefusal(issues);
    const realEffects = subscriptions.realEffectsOf(data.graph);
    if (realEffects.length > 0 && data.confirmRealEffects !== true) {
      throw new HTTPResult(409, {
        error: "the draft has steps a test runs for real: confirm them first",
        message: `${API}.testNeedsConfirm`,
        realEffects,
      });
    }
    const runId = await subscriptions.testRun(
      id,
      data.graph,
      data.payload ?? {},
      data.triggerNodeId,
    );
    return await runOutcome(runId, false);
  }

  /**
   * The steps a test run of the draft executes for real: actions that act
   * outside the run and cannot simulate it. The builder lists them for the
   * user to confirm before the test starts.
   */
  @Post("/:id/test-effects")
  async testEffects(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: DataValue,
  ) {
    const data = parseBody(testEffectsSchema, body);
    await loadProcedure(id);
    return { realEffects: subscriptions.realEffectsOf(data.graph) };
  }

  /** The last real payload of a trigger: the default test payload. */
  @Get("/:id/last-payload")
  async lastPayload(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
    @Parameter("triggerNodeId", "query") triggerNodeId?: string,
  ) {
    await loadProcedure(id);
    return await lastPayloadOf(id, triggerNodeId);
  }

  /** The triggers of the saved graph, with the next time a schedule fires. */
  @Get("/:id/triggers")
  async triggers(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    return { triggers: savedTriggersOf(graphOf(await loadProcedure(id))) };
  }

  /** Over-fetch one row so the client can tell whether a next page exists. */
  @Get("/:id/runs")
  async runs(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
    @Parameter("page", "query") page?: string,
    @Parameter("limit", "query") limit?: string,
  ) {
    const params = pageParams(page, limit);
    await loadProcedure(id);
    const model = GetModel(ProcedureRunModel, DATABASE_NAME);
    return await model.listByProcedure(id, params.page, params.limit, true);
  }
}
