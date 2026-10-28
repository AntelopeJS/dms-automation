import { HTTPResult } from "@antelopejs/interface-api";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { BusMessage, ChangeMessage } from "../cluster/bus";
import * as bus from "../cluster/bus";
import { instanceId } from "../cluster/instance";
import { AutomationTemplateModel } from "../db/models/automation_template.model";
import { DATABASE_NAME } from "../types/constants";
import type { ProcedureGraph } from "../types/graph";
import { MANUAL_TRIGGER_ID } from "./builtins/triggers/manual";
import {
  executeProcedure,
  findTriggerNode,
  loadProcedure,
  parseStoredGraph,
} from "./runProcedure";
import {
  activationErrors,
  reconcile,
  useLeadershipSource as useLeader,
} from "./reconcile";
import { serialQueue } from "./serialQueue";
import { type RealEffectStep, realEffectStepsOf } from "./sideEffects";
import { getTemplate, templateCache, templates } from "./templateCacheState";
import {
  bumpVersionOfUsages,
  disableInvalidUsages,
  forkUsage,
} from "./templateUsages";
import { handles, key, release, teardown } from "./triggerHandles";

/**
 * Why a run cannot start from `triggerNodeId`: it is not in the graph, or the
 * graph has no trigger at all.
 */
function noTriggerToRun(
  triggerNodeId: string | undefined,
  owner: string,
): HTTPResult {
  return triggerNodeId
    ? new HTTPResult(404, {
        error: `trigger "${triggerNodeId}" is not in ${owner}`,
        message: "$dms_automation.api.triggerNotFound",
      })
    : new HTTPResult(400, {
        error: `${owner} has no trigger to run from`,
        message: "$dms_automation.api.noTriggerToRun",
      });
}

/**
 * Serialize reconciles: a leadership transition, a route edit, and a bus
 * message can land near-simultaneously, and reconcile mutates the shared
 * handle map. Callers (route handlers, leadership promotion) get THIS
 * reconcile's real outcome. Tearing down the handles of an unregistered
 * trigger type goes through the same queue, so a reconcile queued after it
 * never sees them.
 */
const reconciles = serialQueue();

function queueReconcile(): Promise<void> {
  return reconciles.run(() => reconcile());
}

/**
 * Whether hydrate() ran: before it, the database may not be ready and the
 * boot reconcile arms everything anyway.
 */
let hydrated = false;

/**
 * Reconcile this instance only (a type registration is local to it); a
 * burst of registrations (a module starting, a hot reload) shares one.
 */
function requestReconcile(reason: string): void {
  if (!hydrated) return;
  reconciles.request(reconcile, (err) =>
    Logging.Error(`[dms-automation] reconcile after ${reason} failed:`, err),
  );
}

async function hydrateTemplates(): Promise<void> {
  const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
  const all = await templateModel.listAll();
  templateCache.clear();
  for (const t of all) {
    templateCache.set(t._id, t);
  }
}

/**
 * Disable the procedures a template change leaves invalid, then reconcile
 * trigger subscriptions so the live cache picks up the latest graph (and
 * drops handles for now-disabled procedures). One reconcile covers every
 * affected procedure — reconcile() rebuilds the full desired-handle map from
 * `listEnabled()`. Queued so it serializes with bus/leadership reconciles
 * against the shared handle map.
 */
async function revalidateProceduresUsingTemplate(
  templateId: string,
): Promise<void> {
  if (await disableInvalidUsages(templateId)) await queueReconcile();
}

/**
 * Refresh this instance's template cache for a created/updated template.
 * Drops the entry if the row vanished between write and refresh, so executor
 * calls fail loudly rather than serving stale data. Shared by the local
 * onTemplateChange hook and the bus replay path.
 */
async function refreshTemplateCache(id: string): Promise<void> {
  const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
  const t = await templateModel.getById(id);
  if (t) {
    templateCache.set(id, t);
  } else {
    templateCache.delete(id);
  }
}

/**
 * Apply a change to THIS instance's live state. The single source of truth for
 * what each change kind means locally, shared by the route hooks (via
 * notifyChange) and the bus replay path (onBusMessage) so the two can never
 * drift. For templates the cache is refreshed FIRST so re-validation of usages
 * sees the new shape (a removed port's now-invalid edge would otherwise be
 * missed); a delete drops the entry so dangling references fail validation and
 * auto-disable their consumer.
 * Per-kind cache update for a template change. "template-change" refreshes the
 * affected entry; "template-delete" drops it. Both then re-validate usages.
 */
const templateCacheUpdateByKind: Record<
  Exclude<ChangeMessage["kind"], "procedure">,
  (id: string) => Promise<void> | void
> = {
  "template-change": (id) => refreshTemplateCache(id),
  "template-delete": (id) => {
    templateCache.delete(id);
  },
};

async function applyChange(msg: ChangeMessage): Promise<void> {
  if (msg.kind === "procedure") {
    await queueReconcile();
    return;
  }
  await templateCacheUpdateByKind[msg.kind](msg.id);
  await revalidateProceduresUsingTemplate(msg.id);
}

/**
 * Apply a change locally AND fan it out to peers. The one choke point every
 * mutation path goes through, so propagation can't be forgotten per call site.
 * Publish happens in `finally`: the route has already committed the change to
 * the DB before calling this, so peers must be told to reconcile even if THIS
 * instance's local apply throws (a local DB hiccup) — otherwise the cluster
 * diverges. A local failure still propagates to the caller after publishing.
 */
async function notifyChange(msg: ChangeMessage): Promise<void> {
  try {
    await applyChange(msg);
  } finally {
    await bus.publish(msg);
  }
}

export const subscriptions = {
  /**
   * Boot-time entry point. Loads every template into the in-memory cache so
   * the executor can resolve template-instance group nodes synchronously,
   * then reconciles trigger subscriptions from the enabled-procedure set.
   *
   * Once it ran, a trigger type registered late (a module starting after us)
   * re-arms the procedures waiting for it.
   *
   * Through the chain so a bus replay arriving during boot (the subscriber is
   * live before hydrate in redis mode) can't race this initial reconcile.
   */
  async hydrate(): Promise<void> {
    await hydrateTemplates();
    hydrated = true;
    await queueReconcile();
  },
  /**
   * Called from start() on EVERY boot, in both modes (before hydrate). Redis
   * mode points the leadership gate at the leader module's live lock state —
   * the single source of truth; memory mode injects `() => true` so the sole
   * instance is permanently leader. Re-setting it each boot keeps a restart
   * from inheriting a stale source.
   */
  useLeadershipSource(check: () => boolean): void {
    useLeader(check);
  },
  /**
   * Promotion hook: the leader module has already flipped its lock state to
   * held, so reconcile reads `amLeader() === true` and arms singletons. We let a
   * failure propagate (don't swallow): the leader module catches it, releases
   * the lock, and a fresh election retries — otherwise the cluster would have a
   * leader that never armed its singletons. No local flag to reset; leadership
   * lives in the leader module.
   */
  async onBecameLeader(): Promise<void> {
    await queueReconcile();
  },
  /**
   * The leader module has cleared its lock state, so reconcile now reads
   * `amLeader() === false` and deactivates singletons; replicated untouched.
   */
  async onLostLeadership(): Promise<void> {
    await queueReconcile();
  },
  async onProcedureChange(_procedureId?: string): Promise<void> {
    await notifyChange({ kind: "procedure" });
  },
  async onProcedureDelete(_procedureId: string): Promise<void> {
    await notifyChange({ kind: "procedure" });
  },
  /** Called by the templates routes after a template is created or updated. */
  async onTemplateChange(id: string): Promise<void> {
    await bumpVersionOfUsages(id);
    await notifyChange({ kind: "template-change", id });
  },
  /**
   * Called by the templates routes after a template is deleted.
   *
   * IMPORTANT: the force-delete path in routes/templates.ts calls
   * `forkUsageToLocal` BEFORE this hook so the cache is still populated when
   * the fork helper does its lookup. See `forkUsageToLocal` below.
   */
  async onTemplateDelete(id: string): Promise<void> {
    await notifyChange({ kind: "template-delete", id });
  },
  /**
   * Wired as the bus subscriber in redis mode. Replays a peer's change locally
   * via the same applyChange path the local hooks use (so the two never drift),
   * minus the re-publish. The handler is invoked fire-and-forget
   * (`void onBusMessage(...)`), so it must never reject — a DB hiccup while
   * replaying a peer edit would otherwise surface as an unhandledRejection.
   * Failures are logged and dropped; the edit self-heals on the next reconcile.
   */
  async onBusMessage(msg: BusMessage): Promise<void> {
    if (msg.origin === instanceId) return;
    try {
      await applyChange(msg);
    } catch (err) {
      Logging.Error("[dms-automation] bus replay failed:", msg, err);
    }
  },
  /**
   * Convert a template-instance group node into a local group with its own
   * inline subgraph (a deep clone of the template's). Used by the DELETE
   * route's force-fork path to detach every usage before the template row is
   * removed.
   *
   * Order constraint: this MUST run while the template is still in the
   * cache. The DELETE route's loop runs this BEFORE `onTemplateDelete`, which
   * removes the cache entry. If the cache lookup fails, the fork is a no-op
   * — the route caller then proceeds with delete and the dangling reference
   * surfaces as a validation failure on next change (auto-disabling the
   * consumer).
   *
   * The instance may sit inside local groups: `groupPath` (the usage's, ids
   * outermost first) finds it there; without it, the first node with that id
   * at any depth is forked.
   */
  async forkUsageToLocal(
    procedureId: string,
    nodeId: string,
    groupPath?: readonly string[],
  ): Promise<void> {
    await forkUsage(procedureId, nodeId, groupPath, getTemplate);
  },
  /**
   * A trigger type was registered: arm the enabled procedures that wait for
   * it. Without this, a type registered after the boot reconcile (its module
   * started after ours, or was hot-reloaded) left them "not available" until
   * the next procedure change or restart.
   */
  onTriggerTypeRegistered(typeId: string): void {
    requestReconcile(`trigger type "${typeId}" registered`);
  },
  /**
   * A trigger type was unregistered: tear down each handle with its own
   * definition, then reconcile so its procedures report it gone, or re-arm
   * with the replacement. The teardown of the handles armed so far starts at
   * once: a module unregisters its types as it stops, and the core
   * invalidates its context right after, when its `deactivate` can no longer
   * run. A pass already running can have armed handles from both definitions
   * before the queued teardown starts.
   */
  async onTriggerTypeUnregistered(typeId: string): Promise<void> {
    for (const [k, entry] of handles) {
      if (entry.typeId === typeId) void teardown(k, entry);
    }
    await reconciles.run(async () => {
      for (const [k, entry] of handles) {
        if (entry.typeId !== typeId) continue;
        await teardown(k, entry);
        release(k, entry);
      }
    });
    requestReconcile(`trigger type "${typeId}" unregistered`);
  },
  async invokeManual(procedureId: string, payload?: unknown): Promise<string> {
    const procedure = await loadProcedure(procedureId);
    const graph = parseStoredGraph(procedure);
    const manualNode = graph.nodes.find(
      (n) => n.kind === "trigger" && n.typeId === MANUAL_TRIGGER_ID,
    );
    if (!manualNode) {
      throw new HTTPResult(400, {
        error: `procedure "${procedureId}" has no manual trigger node`,
      });
    }
    return await executeProcedure(
      procedure,
      graph,
      manualNode.id,
      payload,
      templates,
    );
  },
  /**
   * Run the saved graph from any of its triggers (the manual one first, then
   * the first trigger) with a caller-given payload: "Run now" from the
   * builder, whatever starts the procedure.
   */
  async runNow(
    procedureId: string,
    payload: unknown,
    triggerNodeId?: string,
  ): Promise<string> {
    const procedure = await loadProcedure(procedureId);
    const graph = parseStoredGraph(procedure);
    const trigger = findTriggerNode(graph, triggerNodeId);
    if (!trigger) {
      throw noTriggerToRun(triggerNodeId, `procedure "${procedureId}"`);
    }
    return await executeProcedure(
      procedure,
      graph,
      trigger.id,
      payload,
      templates,
    );
  },
  /**
   * Run the procedure's saved graph again from the trigger and with the
   * payload of a stored run.
   */
  async rerun(
    procedureId: string,
    run: { _id: string; triggerNodeId: string; triggerPayload: unknown },
  ): Promise<string> {
    const procedure = await loadProcedure(procedureId);
    const graph = parseStoredGraph(procedure);
    if (!findTriggerNode(graph, run.triggerNodeId)) {
      throw new HTTPResult(409, {
        error: "the trigger of this run is no longer in the procedure",
      });
    }
    return await executeProcedure(
      procedure,
      graph,
      run.triggerNodeId,
      run.triggerPayload,
      templates,
      { kind: "rerun", rerunOf: run._id },
    );
  },
  /**
   * Run a draft graph that is not saved. The run is stored as a `test` run so
   * it has a trace, and never counts in the health figures.
   */
  async testRun(
    procedureId: string,
    graph: ProcedureGraph,
    payload: unknown,
    triggerNodeId?: string,
  ): Promise<string> {
    const procedure = await loadProcedure(procedureId);
    const trigger = findTriggerNode(graph, triggerNodeId);
    if (!trigger) throw noTriggerToRun(triggerNodeId, "the draft");
    return await executeProcedure(
      procedure,
      graph,
      trigger.id,
      payload,
      templates,
      { kind: "test" },
    );
  },
  /**
   * The steps a test run of this graph executes for real (see
   * `realEffectStepsOf`): what the user confirms before a test.
   */
  realEffectsOf(graph: ProcedureGraph): RealEffectStep[] {
    return realEffectStepsOf(graph, templates);
  },
  /** Whether a template exists: what a group node may reference. */
  hasTemplate(id: string): boolean {
    return templateCache.has(id);
  },
  /**
   * Why a trigger of this procedure failed to arm on this instance (an invalid
   * cron, a webhook path already taken…), in English, or undefined when every
   * trigger it should run here is armed. Retried on every reconcile.
   * Prefer `armErrorOf(procedure)` (runtime/armErrors.ts): stored on the
   * procedure, translatable, and the same on every instance of a cluster.
   */
  activationErrorOf(procedureId: string): string | undefined {
    const prefix = key(procedureId, "");
    for (const [k, error] of activationErrors) {
      if (k.startsWith(prefix)) return error.message;
    }
    return undefined;
  },
  /** @internal exposed for destroy() in src/index.ts */
  async _deactivateAll(): Promise<void> {
    for (const [k, entry] of handles) {
      await teardown(k, entry);
      release(k, entry);
    }
    activationErrors.clear();
    hydrated = false;
  },
};
