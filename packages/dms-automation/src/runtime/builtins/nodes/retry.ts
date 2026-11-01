import { type NodeExecute, nodeKinds } from "../../nodeKinds";

/**
 * First success: just return — `main` auto-propagates as the
 * implicit continuation.
 *
 * Redirect the continuation to `exhausted` so its downstream folds back
 * into the parent flow (linear) and `main` is suppressed.
 *
 * `exhausted` is a side port — on exhaustion the execute calls
 * ctx.continueWith("exhausted") to elevate it to the continuation for
 * that particular run.
 */
const execute: NodeExecute = async (node, _inputs, ctx) => {
  const max = Math.max(1, Math.floor(Number(node.config.maxAttempts ?? 3)));
  let lastFailure: { error: unknown } | undefined;
  for (let i = 0; i < max; i++) {
    ctx.setOutputs({ attempt: i });
    try {
      await ctx.fireTrigger("body", { iteration: i });
      return;
    } catch (err) {
      lastFailure = { error: err };
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log("warn", `attempt ${i + 1}/${max} failed: ${msg}`);
    }
  }
  const lastError = lastFailure ? lastFailure.error : null;
  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  const name = lastError instanceof Error ? lastError.name : "Error";
  ctx.setOutputs({ attempt: max - 1, error: message, name });
  ctx.continueWith("exhausted");
};

nodeKinds.register("retry", execute, {
  continuationPorts: ["main"],
  sidePorts: ["body", "exhausted"],
  ui: {
    label: "$dms_automation.nodes.kinds.retry",
    icon: "i-ph-arrow-counter-clockwise",
    category: "flow",
    hasTriggerIn: true,
    hasMainTriggerOut: true,
    staticTriggerOuts: ["body", "exhausted"],
    staticDataIns: [],
    staticDataOuts: [
      { name: "attempt", type: "number" },
      { name: "error", type: "string" },
    ],
    defaultConfig: { maxAttempts: 3 },
    configSchema: {
      type: "object",
      properties: { maxAttempts: { type: "number", minimum: 1 } },
    },
  },
});
