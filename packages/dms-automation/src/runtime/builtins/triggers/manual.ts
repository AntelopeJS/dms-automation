import type { TriggerType } from "@antelopejs/interface-dms-automation";

/** Canonical typeId of the manual trigger. */
export const MANUAL_TRIGGER_ID = "manual";

/**
 * Manual trigger. The "activate" handle is a sentinel; this trigger does not
 * fire through `emit`. Instead, executions are dispatched by
 * `subscriptions.invokeManual` (Run-now / API invoke).
 */
export const manualTrigger: TriggerType = {
  id: MANUAL_TRIGGER_ID,
  name: "Manual",
  description: "Triggered by an explicit Run-now action or API invoke",
  icon: "i-ph-play",
  cluster: "replicated",
  configSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: { type: "object" },
  activate: async () => ({}),
  deactivate: async () => {},
};
