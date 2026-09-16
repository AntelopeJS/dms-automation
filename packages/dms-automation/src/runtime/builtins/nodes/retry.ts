import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

async function execute(
  node: GraphNode,
  _inputs: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<void> {
  const max = Math.max(1, Math.floor(Number(node.config.maxAttempts ?? 3)));
  let lastError: unknown = null;
  for (let i = 0; i < max; i++) {
    ctx.setOutputs({ attempt: i });
    try {
      await ctx.fireTrigger("body", { iteration: i });
      // First success: just return — `main` auto-propagates as the
      // implicit continuation.
      return;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log("warn", `attempt ${i + 1}/${max} failed: ${msg}`);
    }
  }
  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  const name = lastError instanceof Error ? lastError.name : "Error";
  ctx.setOutputs({ attempt: max - 1, error: message, name });
  // Redirect the continuation to `exhausted` so its downstream folds back
  // into the parent flow (linear) and `main` is suppressed.
  ctx.continueWith("exhausted");
}

// `exhausted` is a side port — on exhaustion the execute calls
// ctx.continueWith("exhausted") to elevate it to the continuation for
// that particular run.
nodeKinds.register("retry", execute, {
  continuationPorts: ["main"],
  sidePorts: ["body", "exhausted"],
  ui: {
    label: "Retry",
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
      properties: { maxAttempts: { type: "number" } },
    },
  },
});
