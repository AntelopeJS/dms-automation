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
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import type { Procedure } from "../db/tables/procedure.table";
import { DATABASE_NAME, FETCH_ALL_LIMIT } from "../types/constants";
import type { GroupNode, ProcedureGraph } from "../types/graph";
import type { RunLog } from "../types/runLog";
import { MANUAL_TRIGGER_ID } from "./builtins/triggers/manual";
import { run as executorRun } from "./executor";
import { diff } from "./reconcileDiff";
import { registry } from "./registry";
import { validateGraph } from "./validate";

interface HandleEntry {
  handle: unknown;
  typeId: string;
  configHash: string;
  procedureId: string;
  nodeId: string;
}

interface LiveMeta {
  procedure: Procedure;
  graph: ProcedureGraph;
  nodeId: string;
}

const handles = new Map<string, HandleEntry>();
// Latest procedure + graph for each active trigger. The activate callback
// reads from this at fire time so graph edits take effect without
// tearing down and re-creating the handle (which the diff in reconcile()
// only does when typeId/config change).
const liveMeta = new Map<string, LiveMeta>();

// Module-level cache of every workspace-global template. Populated by
// hydrate() at boot and kept in sync by onTemplateChange / onTemplateDelete.
// Read via the local `getTemplate` helper, which is handed to the executor as
// the `TemplateCache` (see executeProcedure) consumed by resolveSubgraph.
const templateCache = new Map<string, AutomationTemplateRow>();

function getTemplate(id: string): AutomationTemplateRow | undefined {
  return templateCache.get(id);
}

// Leadership gate, read LIVE so there is a single source of truth. start()
// sets it (via useLeadershipSource) on every boot: memory/standalone injects
// `() => true`, so the sole instance activates every trigger; redis mode
// injects the leader module's `isLeader`, so this reflects the actual lock
// holder with no second copy to drift.
let amLeader: () => boolean = () => true;

// Serialize reconciles: a leadership transition, a route edit, and a bus
// message can land near-simultaneously, and reconcile mutates the shared
// handle map. Each call runs after the previous one SETTLES (success or
// failure) so one failure never wedges the chain. The returned promise
// reflects THIS reconcile's real outcome — it may reject — so callers (route
// handlers, leadership promotion) can react; the chain itself swallows.
let reconcileChain: Promise<void> = Promise.resolve();
function queueReconcile(): Promise<void> {
  const run = reconcileChain.then(
    () => reconcile(),
    () => reconcile(),
  );
  reconcileChain = run.catch(() => {});
  return run;
}

function key(procedureId: string, nodeId: string): string {
  return `${procedureId}#${nodeId}`;
}

// Upper bound on a single trigger's own activate/deactivate. A trigger
// implementation that hangs would otherwise block the whole serialized
// reconcile chain indefinitely.
const TRIGGER_OP_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`[dms-automation] ${label} timed out after ${ms}ms`)),
      ms,
    );
    // Don't let the fallback timer keep the event loop alive — otherwise a hung
    // trigger teardown could hold the process open for up to `ms` on shutdown.
    timer.unref?.();
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// Tear down one trigger handle, bounded so a misbehaving deactivate can't wedge
// the caller. Returns whether teardown succeeded; callers decide whether to drop
// the handle or keep it for retry. An unregistered type has nothing to call, so
// it counts as torn down.
async function tryDeactivate(k: string, entry: HandleEntry): Promise<boolean> {
  const triggerType = registry.getTrigger(entry.typeId);
  if (!triggerType) return true;
  try {
    await withTimeout(
      triggerType.deactivate(entry.handle),
      TRIGGER_OP_TIMEOUT_MS,
      `deactivate ${entry.typeId} for ${k}`,
    );
    return true;
  } catch (err) {
    Logging.Error(
      `[dms-automation] failed to deactivate ${entry.typeId} for ${k}:`,
      err,
    );
    return false;
  }
}

function parseGraph(raw: string): ProcedureGraph {
  return JSON.parse(raw) as ProcedureGraph;
}

function configHashOf(config: unknown): string {
  return JSON.stringify(config ?? {});
}

interface RunRecord {
  procedureId: string;
  triggerNodeId: string;
  triggerPayload: unknown;
  startedAt: Date;
  endedAt: Date;
  status: "ok" | "failed";
  logs: RunLog;
  errorMessage?: string;
}

async function writeRun({
  procedureId,
  triggerNodeId,
  triggerPayload,
  startedAt,
  endedAt,
  status,
  logs,
  errorMessage,
}: RunRecord): Promise<string> {
  const runModel = GetModel(ProcedureRunModel, DATABASE_NAME);
  const ids = await runModel.insert({
    procedureId,
    startedAt,
    endedAt,
    status,
    errorMessage,
    triggerNodeId,
    triggerPayload: JSON.stringify(triggerPayload ?? null),
    logs,
  });
  return ids[0] ?? "";
}

async function executeProcedure(
  procedure: Procedure,
  graph: ProcedureGraph,
  triggerNodeId: string,
  payload: unknown,
): Promise<string> {
  const procedureId = procedure._id;
  const startedAt = new Date();
  const result = await executorRun(graph, triggerNodeId, payload, {
    procedureId,
    templateCache: { get: getTemplate },
  });
  const endedAt = new Date();
  return await writeRun({
    procedureId,
    triggerNodeId,
    triggerPayload: payload,
    startedAt,
    endedAt,
    status: result.status,
    logs: result.logs,
    errorMessage: result.errorMessage,
  });
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
      if (!typeId) continue;
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
    if (!(await tryDeactivate(k, entry))) {
      // Keep the handle tracked so the NEXT reconcile retries teardown rather
      // than orphaning a possibly-still-armed trigger (a dropped-but-live cron
      // would double-fire alongside a new leader's, uncleaned by any reconcile).
      failedDeactivate.add(k);
      continue;
    }
    handles.delete(k);
    liveMeta.delete(k);
  }
  return failedDeactivate;
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
      continue;
    }
    try {
      const handle = await activateTrigger(triggerType, meta.config, k);
      handles.set(k, {
        handle,
        typeId: meta.typeId,
        configHash: configHashOf(meta.config),
        procedureId: meta.procedure._id,
        nodeId: meta.nodeId,
      });
    } catch (err) {
      Logging.Error(
        `[dms-automation] failed to activate ${meta.typeId} for ${k}:`,
        err,
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
}

async function activateTrigger(
  triggerType: TriggerType,
  config: unknown,
  liveKey: string,
): Promise<unknown> {
  // Bound activate like deactivate: a trigger whose activate never settles would
  // otherwise wedge the whole serialized reconcile chain — blocking even a
  // pending leadership-loss teardown. (Trigger authors must keep activate fast;
  // see README. A timed-out activate is treated as failed and retried next pass.)
  return withTimeout(
    triggerType.activate(config, (payload) => {
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
      ).catch((err) => {
        Logging.Error("[dms-automation] procedure execution failed:", err);
      });
    }),
    TRIGGER_OP_TIMEOUT_MS,
    `activate ${triggerType.id} for ${liveKey}`,
  );
}

async function hydrateTemplates(): Promise<void> {
  const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
  const all = await templateModel.list({ page: 0, limit: FETCH_ALL_LIMIT });
  templateCache.clear();
  for (const t of all.results) {
    templateCache.set(t._id, t);
  }
}

// Re-validate every procedure that references `templateId`. If a procedure
// fails validation and is currently enabled, disable it (so a broken
// template can't keep firing trigger subscriptions against a graph that
// won't execute cleanly). Either way, reconcile trigger subscriptions so
// the live cache picks up the latest graph (and drops handles for now-
// disabled procedures).
async function revalidateProceduresUsingTemplate(
  templateId: string,
): Promise<void> {
  const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
  const procedureModel = GetModel(ProcedureModel, DATABASE_NAME);
  const usages = await templateModel.findUsages(templateId);
  const procIds = new Set(usages.map((u) => u.procedureId));
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
  // One reconcile covers every affected procedure — reconcile() rebuilds
  // the full desired-handle map from `listEnabled()`, so calling it once
  // after the loop is equivalent to calling it per-procedure. Queue it so it
  // serializes with bus/leadership reconciles against the shared handle map.
  if (procIds.size > 0) {
    await queueReconcile();
  }
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
   */
  async forkUsageToLocal(procedureId: string, nodeId: string): Promise<void> {
    const procedureModel = GetModel(ProcedureModel, DATABASE_NAME);
    const p = await procedureModel.get(procedureId);
    if (!p) return;
    let graph: ProcedureGraph;
    try {
      graph = JSON.parse(p.graph) as ProcedureGraph;
    } catch {
      return;
    }
    const node = graph.nodes.find((n) => n.id === nodeId) as
      | GroupNode
      | undefined;
    if (!node) return;
    if (!node.templateId) return; // already local — no-op
    const tpl = templateCache.get(node.templateId);
    if (!tpl) return;
    delete node.templateId;
    node.subgraph = structuredClone(tpl.subgraph);
    await procedureModel.update(procedureId, {
      graph: JSON.stringify(graph),
      updated_at: new Date(),
    });
  },
  async deactivateAllForTriggerType(typeId: string): Promise<void> {
    for (const [k, entry] of handles) {
      if (entry.typeId !== typeId) continue;
      await tryDeactivate(k, entry); // force teardown: drop regardless of result
      handles.delete(k);
      liveMeta.delete(k);
    }
  },
  async invokeManual(procedureId: string, payload?: unknown): Promise<string> {
    const procedureModel = GetModel(ProcedureModel, DATABASE_NAME);
    const procedure = await procedureModel.get(procedureId);
    if (!procedure) {
      throw new HTTPResult(404, {
        error: `procedure "${procedureId}" not found`,
      });
    }
    let graph: ProcedureGraph;
    try {
      graph = parseGraph(procedure.graph);
    } catch {
      throw new HTTPResult(400, {
        error: `procedure "${procedureId}" has an invalid graph`,
      });
    }
    const manualNode = graph.nodes.find(
      (n) => n.kind === "trigger" && n.typeId === MANUAL_TRIGGER_ID,
    );
    if (!manualNode) {
      throw new HTTPResult(400, {
        error: `procedure "${procedureId}" has no manual trigger node`,
      });
    }
    return await executeProcedure(procedure, graph, manualNode.id, payload);
  },
  /** @internal exposed for destroy() in src/index.ts */
  async _deactivateAll(): Promise<void> {
    for (const [k, entry] of handles) {
      await tryDeactivate(k, entry); // force teardown: drop regardless of result
      handles.delete(k);
      liveMeta.delete(k);
    }
  },
};
