import { type NodeExecute, nodeKinds } from "../../nodeKinds";

/**
 * `main` auto-propagates after execute returns whether the try
 * succeeded or the catch ran — useful for cleanup wired after the
 * protected block.
 */
const execute: NodeExecute = async (_node, _inputs, ctx) => {
  try {
    await ctx.fireTrigger("try");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : "Error";
    ctx.setOutputs({ error: message, name });
    ctx.log("warn", `caught ${name}: ${message}`);
    await ctx.fireTrigger("catch");
  }
};

nodeKinds.register("tryCatch", execute, {
  continuationPorts: ["main"],
  sidePorts: ["try", "catch"],
  ui: {
    label: "$dms_automation.nodes.kinds.tryCatch",
    icon: "i-ph-shield-warning",
    category: "flow",
    hasTriggerIn: true,
    hasMainTriggerOut: true,
    staticTriggerOuts: ["try", "catch"],
    staticDataIns: [],
    staticDataOuts: [
      { name: "error", type: "string" },
      { name: "name", type: "string" },
    ],
    defaultConfig: {},
    configSchema: { type: "object", properties: {} },
  },
});
