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
import type { ConfirmDialog } from "@antelopejs/interface-dms/base";
import { serializeConfirmDialog } from "@antelopejs/interface-dms/base/confirm-dialog";
import { z } from "zod";
import { ProcedureModel } from "../db/models/procedure.model";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import { getProceduresSummary } from "../db/models/stats.model";
import type { Procedure } from "../db/tables/procedure.table";
import { readTriggerPayload } from "../runtime/boundRunLog";
import { parseGraphSafe, triggersOf } from "../runtime/describe";
import {
  type GraphIssue,
  graphIssues,
  hasBlockingIssue,
  hasTrigger,
} from "../runtime/graphIssues";
import { nextOccurrence } from "../runtime/schedule";
import { subscriptions } from "../runtime/subscriptions";
import { DATABASE_NAME, MS_PER_DAY } from "../types/constants";
import type { GraphNode, ProcedureGraph } from "../types/graph";
import { isProductionRun } from "../types/runLog";
import { procedureGraphSchema } from "./graphSchema";

const procedureBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().optional(),
  enabled: z.boolean(),
  graph: procedureGraphSchema,
});

type ProcedureBody = z.infer<typeof procedureBodySchema>;

const STARTERS = ["webhook", "schedule.cron", "manual"] as const;

const newProcedureSchema = z.object({
  name: z.string().trim().min(1).max(200),
  trigger: z.enum(STARTERS),
  description: z.string().nullish(),
});

const importSchema = z.object({ json: z.string().min(1) });

const exportedSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().optional(),
  graph: procedureGraphSchema,
});

const enabledSchema = z.object({ enabled: z.boolean() });

const runNowSchema = z
  .object({
    payload: z.unknown().optional(),
    triggerNodeId: z.string().optional(),
  })
  .nullish();

const testSchema = z.object({
  graph: procedureGraphSchema,
  payload: z.unknown().optional(),
  triggerNodeId: z.string().optional(),
});

/** A refused body, its issues listed. */
function invalid(error: string, issues: unknown): HTTPResult {
  return new HTTPResult(400, { error, issues });
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw invalid("invalid body", parsed.error.issues);
  return parsed.data;
}

/**
 * The problems of a graph about to be saved. An enabled procedure must have a
 * trigger and no error: enabling it would arm triggers on a graph the
 * executor refuses. A disabled one is saved as a draft with its problems,
 * which the builder lists.
 */
function checkSavable(graph: ProcedureGraph, enabled: boolean): GraphIssue[] {
  const issues = graphIssues(graph);
  if (!enabled) return issues;
  if (hasBlockingIssue(issues)) throw invalid("invalid graph", issues);
  if (!hasTrigger(graph)) {
    throw invalid("invalid graph", [
      {
        severity: "error",
        message: "a procedure needs a trigger before it can be enabled",
      },
    ]);
  }
  return issues;
}

async function loadProcedure(id: string): Promise<Procedure> {
  const procedure = await GetModel(ProcedureModel, DATABASE_NAME).get(id);
  if (!procedure) {
    throw new HTTPResult(404, { error: `procedure "${id}" not found` });
  }
  return procedure;
}

function graphOf(procedure: Procedure): ProcedureGraph {
  const graph = parseGraphSafe(procedure.graph);
  if (!graph) {
    throw new HTTPResult(400, {
      error: `procedure "${procedure._id}" has an invalid graph`,
    });
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
const DEFAULT_SCHEDULE = "0 9 * * 1";

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

const STARTER_CONFIG: Record<
  (typeof STARTERS)[number],
  (name: string) => Record<string, unknown>
> = {
  webhook: (name) => ({ path: `/webhooks/${slugOf(name)}`, method: "POST" }),
  "schedule.cron": () => ({ cron: DEFAULT_SCHEDULE }),
  manual: () => ({}),
};

/** A graph holding only the trigger picked in the "New procedure" dialog. */
function starterGraph(
  trigger: (typeof STARTERS)[number],
  name: string,
): ProcedureGraph {
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
    graph: JSON.stringify(graph),
    version: 1,
    created_at: now,
    updated_at: now,
  });
  const id = ids[0];
  if (!id) {
    throw new HTTPResult(500, { error: "procedure insert returned no id" });
  }
  await subscriptions.onProcedureChange(id);
  return id;
}

/** What changes when a procedure stops: its webhooks and schedules. */
function stopImpact(graph: ProcedureGraph | undefined) {
  return (graph ? triggersOf(graph) : [])
    .filter((t) => t.path || t.cron)
    .map((t) =>
      t.path
        ? {
            icon: "i-ph-webhooks-logo",
            label: "$dms_automation.procedures.deleteImpact.webhook",
            count: `${t.method} ${t.path}`,
          }
        : {
            icon: "i-ph-clock",
            label: "$dms_automation.procedures.deleteImpact.schedule",
            count: t.cron,
          },
    );
}

/** The payload of the last production run that started from a trigger. */
async function lastPayloadOf(procedureId: string, triggerNodeId?: string) {
  const runs = await GetModel(ProcedureRunModel, DATABASE_NAME).listByProcedure(
    procedureId,
    0,
    20,
  );
  const last = runs.find(
    (r) =>
      isProductionRun(r.kind) &&
      (!triggerNodeId || r.triggerNodeId === triggerNodeId),
  );
  if (!last) return null;
  const run = await GetModel(ProcedureRunModel, DATABASE_NAME).get(last._id);
  const stored = readTriggerPayload(run?.triggerPayload);
  return stored.kept
    ? {
        runId: last._id,
        triggerNodeId: last.triggerNodeId,
        startedAt: new Date(last.startedAt).toISOString(),
        payload: stored.payload,
      }
    : null;
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
    const pageNum = page ? Number(page) : 0;
    const limitNum = limit ? Number(limit) : 20;
    return await model.list({ page: pageNum, limit: limitNum });
  }

  // Per-procedure rows (trigger, state, last runs, success, avg): the
  // builder's procedure switcher reads them. Declared before "/:id".
  @Get("/summary")
  async summary(@AuthRawUser() _user: User) {
    return { results: await getProceduresSummary() };
  }

  /** The problems of a draft graph, for the builder's Problems dock. */
  @Post("/validate")
  async validate(@AuthRawUser() _user: User, @JSONBody() body: unknown) {
    const { graph } = parseBody(
      z.object({ graph: procedureGraphSchema }),
      body,
    );
    return { issues: graphIssues(graph) };
  }

  /**
   * "New procedure": a disabled draft named by the user, with the trigger
   * they picked already placed. The dialog then opens the builder on it.
   */
  @Post("/new")
  async createFromStarter(
    @AuthRawUser() _user: User,
    @JSONBody() body: unknown,
  ) {
    const data = parseBody(newProcedureSchema, body);
    const id = await insertDraft(
      data.name,
      data.description ?? "",
      starterGraph(data.trigger, data.name),
    );
    return { _id: id };
  }

  /** "Import JSON": an exported procedure becomes a new disabled draft. */
  @Post("/import")
  async importJson(@AuthRawUser() _user: User, @JSONBody() body: unknown) {
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
        message: "$dms_automation.importProcedure.notProcedure",
      });
    }
    const id = await insertDraft(
      parsed.data.name,
      parsed.data.description ?? "",
      parsed.data.graph,
    );
    return { _id: id, issues: graphIssues(parsed.data.graph) };
  }

  @Get("/:id")
  async getOne(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    return await loadProcedure(id);
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

  @Post("")
  async create(@AuthRawUser() _user: User, @JSONBody() body: unknown) {
    const data: ProcedureBody = parseBody(procedureBodySchema, body);
    const issues = checkSavable(data.graph, data.enabled);
    const model = GetModel(ProcedureModel, DATABASE_NAME);
    const now = new Date();
    const ids = await model.insert({
      name: data.name,
      description: data.description ?? "",
      enabled: data.enabled,
      graph: JSON.stringify(data.graph),
      version: 1,
      created_at: now,
      updated_at: now,
    });
    const id = ids[0];
    if (!id) {
      throw new HTTPResult(500, { error: "procedure insert returned no id" });
    }
    await subscriptions.onProcedureChange(id);
    return { _id: id, version: 1, issues };
  }

  @Put("/:id")
  async update(
    @AuthRawUser() user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: unknown,
  ) {
    const data: ProcedureBody = parseBody(procedureBodySchema, body);
    const existing = await loadProcedure(id);
    const issues = checkSavable(data.graph, data.enabled);
    const version = (existing.version ?? 1) + 1;
    const patch: Partial<Procedure> = {
      name: data.name,
      description: data.description ?? "",
      enabled: data.enabled,
      graph: JSON.stringify(data.graph),
      version,
      updated_at: new Date(),
    };
    if (existing.enabled && !data.enabled) {
      patch.pausedAt = new Date();
      patch.pausedBy = user.name ?? user.email;
    }
    await GetModel(ProcedureModel, DATABASE_NAME).update(id, patch);
    if (existing.name !== data.name) {
      await GetModel(ProcedureRunModel, DATABASE_NAME).renameProcedure(
        id,
        data.name,
      );
    }
    await subscriptions.onProcedureChange(id);
    return { _id: id, version, issues };
  }

  /** Pause or resume a procedure without touching its graph. */
  @Put("/:id/enabled")
  async setEnabled(
    @AuthRawUser() user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: unknown,
  ) {
    const { enabled } = parseBody(enabledSchema, body);
    const procedure = await loadProcedure(id);
    if (enabled) checkSavable(graphOf(procedure), true);
    const patch: Partial<Procedure> = { enabled, updated_at: new Date() };
    if (!enabled && procedure.enabled) {
      patch.pausedAt = new Date();
      patch.pausedBy = user.name ?? user.email;
    }
    await GetModel(ProcedureModel, DATABASE_NAME).update(id, patch);
    await subscriptions.onProcedureChange(id);
    return { _id: id, enabled };
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
    return { _id: id };
  }

  @Delete("/:id")
  async remove(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const model = GetModel(ProcedureModel, DATABASE_NAME);
    await model.delete(id);
    await subscriptions.onProcedureDelete(id);
    return { _id: id };
  }

  /**
   * The delete dialog, worded for the procedure: what stops answering, how
   * often it ran this week, and, for an enabled one, its name to type.
   */
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
    const graph = parseGraphSafe(procedure.graph);
    const dialog: ConfirmDialog = {
      title: "$dms_automation.procedures.deleteTitle",
      description: procedure.enabled
        ? "$dms_automation.procedures.deleteEnabledDescription"
        : "$dms_automation.procedures.deleteDescription",
      params: { name: procedure.name, count: runs.length },
      icon: "i-ph-trash",
      color: "error",
      confirmLabel: "$dms_automation.procedures.deleteConfirm",
      impact: procedure.enabled ? stopImpact(graph) : [],
    };
    // An enabled procedure is deleted by typing its name.
    if (procedure.enabled) dialog.confirmText = procedure.name;
    return serializeConfirmDialog(dialog);
  }

  /** Run the saved graph of a procedure with a manual trigger (API invoke). */
  @Post("/:id/run")
  async run(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: unknown,
  ) {
    const runId = await subscriptions.invokeManual(id, body);
    return { runId };
  }

  /**
   * Run now: the saved graph, from the given trigger (the manual one or the
   * first by default), with the given payload, or the last real payload of
   * that trigger when none is given.
   */
  @Post("/:id/run-now")
  async runNow(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: unknown,
  ) {
    const data = parseBody(runNowSchema, body) ?? {};
    const hasPayload = Object.hasOwn(data, "payload");
    const payload = hasPayload
      ? data.payload
      : ((await lastPayloadOf(id, data.triggerNodeId))?.payload ?? {});
    const runId = await subscriptions.runNow(id, payload, data.triggerNodeId);
    return { runId };
  }

  /**
   * Test run: execute a draft graph without saving it. The run is kept as a
   * `test` run so it has a trace, and never counts in the health figures.
   */
  @Post("/:id/test")
  async test(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: unknown,
  ) {
    const data = parseBody(testSchema, body);
    const issues = graphIssues(data.graph);
    if (hasBlockingIssue(issues)) throw invalid("invalid graph", issues);
    const runId = await subscriptions.testRun(
      id,
      data.graph,
      data.payload ?? {},
      data.triggerNodeId,
    );
    return { runId };
  }

  /** The last real payload of a trigger: the default test payload. */
  @Get("/:id/last-payload")
  async lastPayload(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
    @Parameter("triggerNodeId", "query") triggerNodeId?: string,
  ) {
    return { last: await lastPayloadOf(id, triggerNodeId) };
  }

  /** The triggers of the saved graph, with the next time a schedule fires. */
  @Get("/:id/triggers")
  async triggers(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const graph = graphOf(await loadProcedure(id));
    return {
      triggers: triggersOf(graph).map((t) => ({
        ...t,
        nextAt: t.cron ? (nextOccurrence(t.cron)?.toISOString() ?? null) : null,
      })),
    };
  }

  @Get("/:id/runs")
  async runs(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
    @Parameter("page", "query") page?: string,
    @Parameter("limit", "query") limit?: string,
  ) {
    const model = GetModel(ProcedureRunModel, DATABASE_NAME);
    const pageNum = page ? Number(page) : 0;
    const limitNum = limit ? Number(limit) : 20;
    // Over-fetch one row so the client can tell whether a next page exists.
    return await model.listByProcedure(id, pageNum, limitNum, true);
  }
}
