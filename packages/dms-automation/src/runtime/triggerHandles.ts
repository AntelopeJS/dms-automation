import { Logging } from "@antelopejs/interface-core/logging";
import type { TriggerType } from "@antelopejs/interface-dms-automation";
import type { Procedure } from "../db/tables/procedure.table";
import type { ProcedureGraph } from "../types/graph";
import { withTimeout } from "./withTimeout";

/**
 * Whether a handle may still start runs: cleared once it is let go.
 */
export interface Armed {
  armed: boolean;
}

export interface HandleEntry {
  handle: unknown;
  type: TriggerType;
  typeId: string;
  configHash: string;
  procedureId: string;
  nodeId: string;
  live: Armed;
  /** The teardown in progress, shared by everyone tearing this handle down. */
  teardown?: Promise<boolean>;
}

export interface LiveMeta {
  procedure: Procedure;
  graph: ProcedureGraph;
  nodeId: string;
}

/**
 * The trigger handles armed on this instance, tracked by
 * `<procedureId>#<nodeId>`; the reconcile in subscriptions.ts decides which.
 */
export const handles = new Map<string, HandleEntry>();
/**
 * Latest procedure + graph for each active trigger. The activate callback
 * reads from this at fire time so graph edits take effect without
 * tearing down and re-creating the handle (which the diff in reconcile()
 * only does when typeId/config change).
 */
export const liveMeta = new Map<string, LiveMeta>();

/**
 * Upper bound on a single trigger's own activate/deactivate. A trigger
 * implementation that hangs would otherwise block the whole serialized
 * reconcile chain indefinitely.
 */
export const TRIGGER_OP_TIMEOUT_MS = 10_000;

/**
 * Tear down one trigger handle, bounded so a misbehaving deactivate can't wedge
 * the caller. Returns whether teardown succeeded; callers decide whether to drop
 * the handle or keep it for retry. Keep the definition that created EACH handle:
 * a reload can replace the registry entry while another activation is awaiting.
 */
async function tryDeactivate(k: string, entry: HandleEntry): Promise<boolean> {
  try {
    await withTimeout(
      entry.type.deactivate(entry.handle),
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

/**
 * One teardown per handle at a time: a departing trigger type starts its own
 * outside the reconcile queue (see onTriggerTypeUnregistered), and a pass in
 * progress may be tearing the same handle down. A failed one can be retried.
 */
export function teardown(k: string, entry: HandleEntry): Promise<boolean> {
  entry.teardown ??= tryDeactivate(k, entry).then((ok) => {
    if (!ok) entry.teardown = undefined;
    return ok;
  });
  return entry.teardown;
}

/**
 * Stop tracking a handle that is torn down, or given up on: it starts no run
 * from now on, even if its trigger still calls `emit`.
 */
export function release(k: string, entry: HandleEntry): void {
  entry.live.armed = false;
  if (handles.get(k) !== entry) return;
  handles.delete(k);
  liveMeta.delete(k);
}
