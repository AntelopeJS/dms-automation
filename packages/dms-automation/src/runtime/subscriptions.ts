import { AsyncResource } from "node:async_hooks";
import { HTTPResult } from "@antelopejs/interface-api";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { TriggerType } from "@antelopejs/interface-dms-automation";
import type { BusMessage, ChangeMessage } from "../cluster/bus";
import * as bus from "../cluster/bus";
import { instanceId } from "../cluster/instance";
import {
  AutomationTemplateModel,
  type AutomationTemplateRow,
} from "../db/models/automation_template.model";
import { ProcedureModel } from "../db/models/procedure.model";
import type { Procedure } from "../db/tables/procedure.table";
import { DATABASE_NAME } from "../types/constants";
import type { ProcedureGraph } from "../types/graph";
import { MANUAL_TRIGGER_ID } from "./builtins/triggers/manual";
import {
  type ArmedWebhook,
  namedRouteConflict,
  webhookTrigger,
} from "./builtins/triggers/webhook";
import {
  executeProcedure,
  findTriggerNode,
  loadProcedure,
  parseStoredGraph,
} from "./runProcedure";
import { type ArmError, armErrorFrom, storeArmErrors } from "./armErrors";
import { isModuleGone } from "./departed";
import { diff } from "./reconcileDiff";
import { registry } from "./registry";
import { serialQueue } from "./serialQueue";
import {
  bumpVersionOfUsages,
  disableInvalidUsages,
  forkUsage,
} from "./templateUsages";
import {
  type Armed,
  handles,
  liveMeta,
  release,
  TRIGGER_OP_TIMEOUT_MS,
  teardown,
} from "./triggerHandles";
import { isTriggerTypeDisabled, refreshTypeSwitches } from "./typeSwitches";
import { withTimeout } from "./withTimeout";

// Why a desired trigger failed to arm on this instance, by key. Kept until the
// trigger arms or is no longer desired, and written on the procedure after
// each reconcile (storeArmErrors), so the procedures list can tell an enabled
// procedure that will never start from a healthy one.
const activationErrors = new Map<string, ArmError>();

// Module-level cache of every workspace-global template. Populated by
// hydrate() at boot and kept in sync by onTemplateChange / onTemplateDelete.
// Read via the local `getTemplate` helper, which is handed to the executor as
// the `TemplateCache` (see executeProcedure) consumed by resolveSubgraph.
const templateCache = new Map<string, AutomationTemplateRow>();

function getTemplate(id: string): AutomationTemplateRow | undefined {
  return templateCache.get(id);
}

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

const templates = { get: getTemplate };

// Leadership gate, read LIVE so there is a single source of truth. start()
// sets it (via useLeadershipSource) on every boot: memory/standalone injects
// `() => true`, so the sole instance activates every trigger; redis mode
// injects the leader module's `isLeader`, so this reflects the actual lock
// holder with no second copy to drift.
let amLeader: () => boolean = () => true;

// Serialize reconciles: a leadership transition, a route edit, and a bus
// message can land near-simultaneously, and reconcile mutates the shared
// handle map. Callers (route handlers, leadership promotion) get THIS
// reconcile's real outcome. Tearing down the handles of an unregistered
// trigger type goes through the same queue, so a reconcile queued after it
// never sees them.
const reconciles = serialQueue();

function queueReconcile(): Promise<void> {
  return reconciles.run(() => reconcile());
}

// Whether hydrate() ran: before it, the database may not be ready and the
// boot reconcile arms everything anyway.
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

function key(procedureId: string, nodeId: string): string {
  return `${procedureId}#${nodeId}`;
}

function parseGraph(raw: string): ProcedureGraph {
  return JSON.parse(raw) as ProcedureGraph;
}

function configHashOf(config: unknown): string {
  return JSON.stringify(config ?? {});
}

interface DesiredTrigger {
  typeId: string;
  configHash: string;
}

interface DesiredMeta {
  procedure: Procedure;
  graph: ProcedureGraph;
  nodeId: string;
  config: unknown;
  typeId: string;
}

interface DesiredTriggerSet {
  desired: Map<string, DesiredTrigger>;
  desiredMeta: Map<string, DesiredMeta>;
}

// Build the desired trigger map (and the procedure/node metadata activation
// needs) from the enabled procedures. Singleton triggers run only on the leader.
// Followers omit them from the desired map, so the diff deactivates any they were
// holding and never activates new ones. Replicated triggers are always desired.
// Fail closed: a registered type whose classification isn't explicitly
// "replicated" is treated as singleton so a mislabeled type can't fan out to
// every instance. (Unregistered types fall through and are skipped at activation.)
function computeDesiredTriggers(
  enabled: Procedure[],
  leader: boolean,
): DesiredTriggerSet {
  const desired = new Map<string, DesiredTrigger>();
  const desiredMeta = new Map<string, DesiredMeta>();
  for (const procedure of enabled) {
    const procedureId = procedure._id;
    let graph: ProcedureGraph;
    try {
      graph = parseGraph(procedure.graph);
    } catch (err) {
      Logging.Error(
        `[dms-automation] reconcile: skipping procedure "${procedureId}" — graph JSON parse failed:`,
        err,
      );
      continue;
    }
    for (const node of graph.nodes) {
      if (node.kind !== "trigger") continue;
      const typeId = node.typeId;
      if (!typeId || isTriggerTypeDisabled(typeId)) continue;
      const triggerType = registry.getTrigger(typeId);
      if (triggerType && triggerType.cluster !== "replicated" && !leader)
        continue;
      const k = key(procedureId, node.id);
      desired.set(k, { typeId, configHash: configHashOf(node.config) });
      desiredMeta.set(k, {
        procedure,
        graph,
        nodeId: node.id,
        config: node.config,
        typeId,
      });
    }
  }
  return { desired, desiredMeta };
}

// Tear down stale handles first. Returns the keys whose teardown failed so the
// activate pass skips re-arming them (a config change puts the same key in BOTH
// lists — re-activating over a failed teardown would overwrite the kept handle
// and orphan the still-armed old trigger).
async function deactivateStaleHandles(
  toDeactivate: Iterable<string>,
): Promise<Set<string>> {
  const failedDeactivate = new Set<string>();
  for (const k of toDeactivate) {
    const entry = handles.get(k);
    if (!entry) continue;
    if (!(await teardown(k, entry))) {
      // Keep the handle tracked so the NEXT reconcile retries teardown rather
      // than orphaning a possibly-still-armed trigger (a dropped-but-live cron
      // would double-fire alongside a new leader's, uncleaned by any reconcile).
      failedDeactivate.add(k);
      continue;
    }
    release(k, entry);
  }
  return failedDeactivate;
}

/** The webhooks armed here, with the procedure each belongs to. */
function armedWebhooks(): ArmedWebhook[] {
  return [...handles]
    .filter(([, entry]) => entry.typeId === webhookTrigger.id)
    .map(([k, entry]) => ({
      config: JSON.parse(entry.configHash) as Record<string, unknown>,
      procedure: liveMeta.get(k)?.procedure.name ?? entry.procedureId,
    }));
}

async function activateNewHandles(
  toActivate: Iterable<string>,
  desiredMeta: Map<string, DesiredMeta>,
  failedDeactivate: Set<string>,
): Promise<void> {
  for (const k of toActivate) {
    // Don't re-arm a key whose old handle we just failed to tear down — that
    // would overwrite the kept handle. The next reconcile retries teardown first.
    if (failedDeactivate.has(k)) continue;
    const meta = desiredMeta.get(k);
    if (!meta) continue;
    const triggerType = registry.getTrigger(meta.typeId);
    if (!triggerType) {
      Logging.Warn(
        `[dms-automation] trigger type "${meta.typeId}" not registered; skipping ${k}`,
      );
      activationErrors.set(k, {
        code: "unknownType",
        params: { type: meta.typeId },
        message: `trigger type "${meta.typeId}" is not available`,
      });
      continue;
    }
    const live: Armed = { armed: true };
    try {
      const handle = await activateTrigger(triggerType, meta.config, k, live);
      handles.set(k, {
        handle,
        type: triggerType,
        typeId: meta.typeId,
        configHash: configHashOf(meta.config),
        procedureId: meta.procedure._id,
        nodeId: meta.nodeId,
        live,
      });
      activationErrors.delete(k);
    } catch (err) {
      live.armed = false;
      // Unregistered while this pass held it: the reconcile its departure
      // requests arms the procedure again, or says why it cannot.
      if (isModuleGone(err)) continue;
      Logging.Error(
        `[dms-automation] failed to activate ${meta.typeId} for ${k}:`,
        err,
      );
      activationErrors.set(
        k,
        namedRouteConflict(
          armErrorFrom(err),
          meta.config as Record<string, unknown>,
          armedWebhooks(),
        ),
      );
    }
  }
}

// Refresh the live procedure/graph for every desired subscription — including
// those whose handle was reused. This is what makes graph edits take effect on
// the next trigger fire without re-activating.
function refreshLiveMeta(desiredMeta: Map<string, DesiredMeta>): void {
  for (const [k, meta] of desiredMeta) {
    liveMeta.set(k, {
      procedure: meta.procedure,
      graph: meta.graph,
      nodeId: meta.nodeId,
    });
  }
}

async function reconcile(): Promise<void> {
  await refreshTypeSwitches();
  const procedureModel = GetModel(ProcedureModel, DATABASE_NAME);
  const enabled = await procedureModel.listEnabled();
  // Snapshot leadership ONCE for the whole pass. Reading it per-node would let a
  // leadership flip mid-loop arm some singletons and skip others (a partial,
  // inconsistent set); a queued follow-up reconcile reconciles the new state.
  const leader = amLeader();

  const { desired, desiredMeta } = computeDesiredTriggers(enabled, leader);

  const current = new Map(
    [...handles].map(([k, v]) => [
      k,
      { typeId: v.typeId, configHash: v.configHash },
    ]),
  );
  const { toActivate, toDeactivate } = diff(current, desired);

  const failedDeactivate = await deactivateStaleHandles(toDeactivate);
  await activateNewHandles(toActivate, desiredMeta, failedDeactivate);
  refreshLiveMeta(desiredMeta);
  for (const k of activationErrors.keys()) {
    if (!desired.has(k)) activationErrors.delete(k);
  }
  await storeArmErrors(desiredMeta, activationErrors);
}

async function activateTrigger(
  triggerType: TriggerType,
  config: unknown,
  liveKey: string,
  live: Armed,
): Promise<unknown> {
  // Bound to this module's context, where the reconcile runs: the trigger's
  // module calls `emit` from its own code, and a run started in ITS context
  // fails every interface call it makes (storing the run included) as soon as
  // that module unloads, a hot reload for one.
  const emit = AsyncResource.bind((payload: unknown) => {
    if (!live.armed) return;
    const meta = liveMeta.get(liveKey);
    if (!meta) {
      Logging.Warn(
        `[dms-automation] trigger fired but no live meta for ${liveKey}; dropped`,
      );
      return;
    }
    void executeProcedure(
      meta.procedure,
      meta.graph,
      meta.nodeId,
      payload,
      templates,
    ).catch((err) => {
      Logging.Error("[dms-automation] procedure execution failed:", err);
    });
  });
  // Bound activate like deactivate: a trigger whose activate never settles would
  // otherwise wedge the whole serialized reconcile chain — blocking even a
  // pending leadership-loss teardown. (Trigger authors must keep activate fast;
  // see README. A timed-out activate is treated as failed and retried next pass.)
  return withTimeout(
    triggerType.activate(config, emit),
    TRIGGER_OP_TIMEOUT_MS,
    `activate ${triggerType.id} for ${liveKey}`,
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

// Disable the procedures a template change leaves invalid, then reconcile
// trigger subscriptions so the live cache picks up the latest graph (and
// drops handles for now-disabled procedures). One reconcile covers every
// affected procedure — reconcile() rebuilds the full desired-handle map from
// `listEnabled()`. Queued so it serializes with bus/leadership reconciles
// against the shared handle map.
async function revalidateProceduresUsingTemplate(
  templateId: string,
): Promise<void> {
  if (await disableInvalidUsages(templateId)) await queueReconcile();
}

// Refresh this instance's template cache for a created/updated template.
// Drops the entry if the row vanished between write and refresh, so executor
// calls fail loudly rather than serving stale data. Shared by the local
// onTemplateChange hook and the bus replay path.
async function refreshTemplateCache(id: string): Promise<void> {
  const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
  const t = await templateModel.getById(id);
  if (t) {
    templateCache.set(id, t);
  } else {
    templateCache.delete(id);
  }
}

// Apply a change to THIS instance's live state. The single source of truth for
// what each change kind means locally, shared by the route hooks (via
// notifyChange) and the bus replay path (onBusMessage) so the two can never
// drift. For templates the cache is refreshed FIRST so re-validation of usages
// sees the new shape (a removed port's now-invalid edge would otherwise be
// missed); a delete drops the entry so dangling references fail validation and
// auto-disable their consumer.
// Per-kind cache update for a template change. "template-change" refreshes the
// affected entry; "template-delete" drops it. Both then re-validate usages.
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

// Apply a change locally AND fan it out to peers. The one choke point every
// mutation path goes through, so propagation can't be forgotten per call site.
// Publish happens in `finally`: the route has already committed the change to
// the DB before calling this, so peers must be told to reconcile even if THIS
// instance's local apply throws (a local DB hiccup) — otherwise the cluster
// diverges. A local failure still propagates to the caller after publishing.
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
   */
  async hydrate(): Promise<void> {
    await hydrateTemplates();
    // From here a trigger type registered late (a module starting after us)
    // re-arms the procedures waiting for it.
    hydrated = true;
    // Through the chain so a bus replay arriving during boot (the subscriber is
    // live before hydrate in redis mode) can't race this initial reconcile.
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
    amLeader = check;
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
  async onLostLeadership(): Promise<void> {
    // The leader module has cleared its lock state, so reconcile now reads
    // `amLeader() === false` and deactivates singletons; replicated untouched.
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
    if (msg.origin === instanceId) return; // we already applied this in-process
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
        await teardown(k, entry); // force teardown: drop regardless of result
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
      await teardown(k, entry); // force teardown: drop regardless of result
      release(k, entry);
    }
    activationErrors.clear();
    hydrated = false;
  },
};
