import type { LogLevel } from "@antelopejs/interface-dms-automation";

/**
 * A fire is one invocation of a trigger-out port: the boundary inside which
 * a sub-walk processes a slice of the trigger DAG. Fires form a tree rooted
 * at the top-level run boundary (`parentFireId === null`).
 *
 *  - `sourceNodeId` is the node whose execute called `ctx.fireTrigger(port)`
 *    (or, for the top-level fire, the run's trigger seed).
 *  - `port` names the trigger-out port being fired. `null` only for the
 *    top-level fire, whose seed has no port discrimination.
 *  - `iteration` is set by higher-order nodes (foreach, forRange, retry)
 *    to annotate per-iteration fires; otherwise undefined.
 *  - `closedAt` is set when the sub-walk completes. Every code path closes
 *    its fires (aborts and failures included), so a persisted RunLog never
 *    contains an open fire.
 */
export interface FireNode {
  id: string;
  parentFireId: string | null;
  sourceNodeId: string;
  port: string | null;
  ts: number;
  /**
   * Monotonic per-run sequence number, incremented on every fire-open AND
   * log-entry append. Tiebreaker for the UI when several events share the
   * same millisecond `ts` (common for fast-running iterations).
   */
  seq: number;
  iteration?: number;
  closedAt?: number;
}

/**
 * A log entry attaches to exactly one fire by id. `ts` is
 * millisecond-resolution and ties across fast interleaved fires; `seq`
 * is the unambiguous ordering key.
 */
export interface LogEntry {
  fireId: string;
  ts: number;
  /** Monotonic per-run sequence number; shared counter with FireNode.seq. */
  seq: number;
  level: LogLevel;
  /** "log" = user-emitted via ctx.log; "exec" = executor structural event. */
  source: "log" | "exec";
  nodeId?: string;
  nodeKind?: string;
  message: string;
  /** Optional structured payload; passed through to the DB adapter as-is. */
  value?: unknown;
}

/**
 * The run-log shape persisted with each procedure run. The fire tree
 * carries nested-group / iteration structure that used to live in the
 * removed `RunLogEntry.path` field.
 */
export interface RunLog {
  fires: FireNode[];
  entries: LogEntry[];
}
