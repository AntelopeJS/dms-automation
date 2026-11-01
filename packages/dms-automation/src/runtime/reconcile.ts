import { AsyncResource } from "node:async_hooks";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { TriggerType } from "@antelopejs/interface-dms-automation";
import { ProcedureModel } from "../db/models/procedure.model";
import type { Procedure } from "../db/tables/procedure.table";
import { DATABASE_NAME } from "../types/constants";
import {
  type DataRecord,
  isDataRecord,
  parseJsonText,
} from "../types/dataValue";
import { parseGraph, type ProcedureGraph } from "../types/graph";
import {
  type ArmedWebhook,
  namedRouteConflict,
  webhookTrigger,
} from "./builtins/triggers/webhook";
import { type ArmError, TriggerArmError, storeArmErrors } from "./armErrors";
import { diff } from "./reconcileDiff";
import { registry } from "./registry";
import { executeProcedure } from "./runProcedure";
import { templates } from "./templateCacheState";
import {
  type Armed,
  configHashOf,
  handles,
  key,
  liveMeta,
  release,
  TRIGGER_OP_TIMEOUT_MS,
  teardown,
} from "./triggerHandles";
import { isTriggerTypeDisabled, refreshTypeSwitches } from "./typeSwitches";
import { withTimeout } from "./withTimeout";

/**
 * Why a desired trigger failed to arm on this instance, by key. Kept until the
 * trigger arms or is no longer desired, and written on the procedure after
 * each reconcile (storeArmErrors), so the procedures list can tell an enabled
 * procedure that will never start from a healthy one.
 */
export const activationErrors = new Map<string, ArmError>();

/**
 * Leadership gate, read LIVE so there is a single source of truth. start()
 * sets it (via useLeadershipSource) on every boot: memory/standalone injects
 * `() => true`, so the sole instance activates every trigger; redis mode
 * injects the leader module's `isLeader`, so this reflects the actual lock
 * holder with no second copy to drift.
 */
let amLeader: () => boolean = () => true;

export function useLeadershipSource(check: () => boolean): void {
  amLeader = check;
}

interface DesiredTrigger {
  typeId: string;
  configHash: string;
}

interface DesiredMeta {
  procedure: Procedure;
  graph: ProcedureGraph;
  nodeId: string;
  config: DataRecord;
  typeId: string;
}

interface DesiredTriggerSet {
  desired: Map<string, DesiredTrigger>;
  desiredMeta: Map<string, DesiredMeta>;
}

/**
 * Build the desired trigger map (and the procedure/node metadata activation
 * needs) from the enabled procedures. Singleton triggers run only on the leader.
 * Followers omit them from the desired map, so the diff deactivates any they were
 * holding and never activates new ones. Replicated triggers are always desired.
 * Fail closed: a registered type whose classification isn't explicitly
 * "replicated" is treated as singleton so a mislabeled type can't fan out to
 * every instance. (Unregistered types fall through and are skipped at activation.)
 */
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

/**
 * Tear down stale handles first. Returns the keys whose teardown failed so the
 * activate pass skips re-arming them (a config change puts the same key in BOTH
 * lists — re-activating over a failed teardown would overwrite the kept handle
 * and orphan the still-armed old trigger).
 *
 * A handle whose teardown fails stays tracked so the NEXT reconcile retries
 * it rather than orphaning a possibly-still-armed trigger (a dropped-but-live
 * cron would double-fire alongside a new leader's, uncleaned by any
 * reconcile).
 */
async function deactivateStaleHandles(
  toDeactivate: Iterable<string>,
): Promise<Set<string>> {
  const failedDeactivate = new Set<string>();
  for (const k of toDeactivate) {
    const entry = handles.get(k);
    if (!entry) continue;
    if (!(await teardown(k, entry))) {
      failedDeactivate.add(k);
      continue;
    }
    release(k, entry);
  }
  return failedDeactivate;
}

/** The settings a handle was armed with: `configHash` is the JSON `configHashOf` wrote. */
function configOf(configHash: string): DataRecord {
  const config = parseJsonText(configHash);
  return isDataRecord(config) ? config : {};
}

/** The webhooks armed here, with the procedure each belongs to. */
function armedWebhooks(): ArmedWebhook[] {
  return [...handles]
    .filter(([, entry]) => entry.typeId === webhookTrigger.id)
    .map(([k, entry]) => ({
      config: configOf(entry.configHash),
      procedure: liveMeta.get(k)?.procedure.name ?? entry.procedureId,
    }));
}

/**
 * Don't re-arm a key whose old handle we just failed to tear down — that
 * would overwrite the kept handle. The next reconcile retries teardown first.
 */
async function activateNewHandles(
  toActivate: Iterable<string>,
  desiredMeta: Map<string, DesiredMeta>,
  failedDeactivate: Set<string>,
): Promise<void> {
  for (const k of toActivate) {
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
      const disarm = await activateTrigger(triggerType, meta.config, k, live);
      handles.set(k, {
        disarm,
        typeId: meta.typeId,
        configHash: configHashOf(meta.config),
        procedureId: meta.procedure._id,
        nodeId: meta.nodeId,
        live,
      });
      activationErrors.delete(k);
    } catch (err) {
      live.armed = false;
      Logging.Error(
        `[dms-automation] failed to activate ${meta.typeId} for ${k}:`,
        err,
      );
      let armError: ArmError;
      if (err instanceof TriggerArmError) {
        armError = err.problem;
      } else {
        const error = err instanceof Error ? err.message : String(err);
        armError = { code: "armFailed", params: { error }, message: error };
      }
      activationErrors.set(
        k,
        namedRouteConflict(armError, meta.config, armedWebhooks()),
      );
    }
  }
}

/**
 * Refresh the live procedure/graph for every desired subscription — including
 * those whose handle was reused. This is what makes graph edits take effect on
 * the next trigger fire without re-activating.
 */
function refreshLiveMeta(desiredMeta: Map<string, DesiredMeta>): void {
  for (const [k, meta] of desiredMeta) {
    liveMeta.set(k, {
      procedure: meta.procedure,
      graph: meta.graph,
      nodeId: meta.nodeId,
    });
  }
}

/**
 * Snapshot leadership ONCE for the whole pass. Reading it per-node would let a
 * leadership flip mid-loop arm some singletons and skip others (a partial,
 * inconsistent set); a queued follow-up reconcile reconciles the new state.
 */
export async function reconcile(): Promise<void> {
  await refreshTypeSwitches();
  const procedureModel = GetModel(ProcedureModel, DATABASE_NAME);
  const enabled = await procedureModel.listEnabled();
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

/**
 * Activate a trigger with its `emit` bound to this module's context, where the
 * reconcile runs: the trigger's module calls `emit` from its own code, and a
 * run started in ITS context fails every interface call it makes (storing the
 * run included) as soon as that module unloads, a hot reload for one.
 *
 * Activate is bounded like deactivate: one that never settles would wedge the
 * whole serialized reconcile chain, a pending leadership-loss teardown
 * included. A timed-out activate counts as failed and is retried next pass
 * (trigger authors keep activate fast; see README).
 *
 * Resolves with the trigger's teardown: its own type's `deactivate`, given
 * the handle its `activate` resolved with.
 */
async function activateTrigger(
  triggerType: TriggerType,
  config: DataRecord,
  liveKey: string,
  live: Armed,
): Promise<() => Promise<void>> {
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
    ).catch((err: unknown) => {
      Logging.Error("[dms-automation] procedure execution failed:", err);
    });
  });
  const handle = await withTimeout(
    triggerType.activate(config, emit),
    TRIGGER_OP_TIMEOUT_MS,
    `activate ${triggerType.id} for ${liveKey}`,
  );
  return () => triggerType.deactivate(handle);
}
