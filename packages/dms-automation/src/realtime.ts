import { Logging } from "@antelopejs/interface-core/logging";
import { PublishMessage } from "@antelopejs/interface-dms";

// Topics the module publishes on when its data changes outside a table's own
// routes. The blocks reading that data declare them as `realtimeTopic`, so
// the pages that show them refresh without a reload.

/** A run was stored: run lists, KPIs and health figures change. */
export const RUNS_TOPIC = "automation.runs";

/** A procedure was created, changed, enabled or paused, or deleted. */
export const PROCEDURES_TOPIC = "automation.procedures";

/**
 * Tell the pages on `topic` that its data changed. Never throws: a page
 * missing one refresh must not fail the write that caused it.
 */
export function notifyTopic(
  topic: string,
  type: string,
  payload?: Record<string, unknown>,
): void {
  PublishMessage(topic, type, payload ? { payload } : undefined).catch(
    (err: unknown) => {
      Logging.Warn(`[dms-automation] could not publish on ${topic}:`, err);
    },
  );
}
