import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

async function execute(
  _node: GraphNode,
  inputs: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<void> {
  const branch = inputs.cond ? "then" : "else";
  ctx.log("info", `branch: ${branch}`);
  // The chosen branch IS the continuation — outer walk auto-propagates
  // through it; the other branch is dead.
  ctx.continueWith(branch);
}

nodeKinds.register("if", execute, {
  continuationPorts: [],
  sidePorts: ["then", "else"],
  ui: {
    label: "If",
    icon: "i-ph-git-branch",
    category: "flow",
    hasTriggerIn: true,
    hasMainTriggerOut: false,
    staticTriggerOuts: ["then", "else"],
    staticDataIns: [{ name: "cond", type: "boolean" }],
    staticDataOuts: [],
  },
});
