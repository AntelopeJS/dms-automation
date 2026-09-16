import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

async function execute(
  _node: GraphNode,
  inputs: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<void> {
  const raw = inputs.items;
  const items = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw)) {
    ctx.log(
      "warn",
      `foreach "items" input is not an array (got ${typeof raw}); iterating zero times`,
    );
  }
  for (let i = 0; i < items.length; i++) {
    ctx.setOutputs({ value: items[i], index: i });
    await ctx.fireTrigger("body", { iteration: i });
  }
  // `main` auto-propagates after execute returns (implicit continuation):
  // unclaimed ports stay live in the outer walk, so the downstream of
  // foreach.main folds back into the parent flow rather than nesting
  // under a `main` child fire.
}

nodeKinds.register("foreach", execute, {
  continuationPorts: ["main"],
  sidePorts: ["body"],
  ui: {
    label: "Foreach",
    icon: "i-ph-arrows-clockwise",
    category: "flow",
    hasTriggerIn: true,
    hasMainTriggerOut: true,
    staticTriggerOuts: ["body"],
    staticDataIns: [{ name: "items", type: "array" }],
    staticDataOuts: [{ name: "value" }, { name: "index", type: "number" }],
    defaultConfig: {},
    configSchema: { type: "object", properties: {} },
  },
});
