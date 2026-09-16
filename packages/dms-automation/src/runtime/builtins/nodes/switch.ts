import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

async function execute(
  node: GraphNode,
  inputs: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<void> {
  const cases = (node.config.cases as string[] | undefined) ?? [];
  const key = String(inputs.value);
  const branch = cases.includes(key) ? key : "default";
  ctx.log("info", `branch: ${branch}`);
  ctx.continueWith(branch);
}

nodeKinds.register("switch", execute, {
  continuationPorts: [],
  sidePorts: [],
  ui: {
    label: "Switch",
    icon: "i-ph-share-network",
    category: "flow",
    hasTriggerIn: true,
    hasMainTriggerOut: false,
    // Dynamic from config.cases, then "default" appended.
    dynamicTriggerOutsFromConfig: "cases",
    staticTriggerOuts: ["default"],
    staticDataIns: [{ name: "value" }],
    staticDataOuts: [],
    defaultConfig: { cases: [] },
    configSchema: {
      type: "object",
      properties: {
        cases: { type: "array", items: { type: "string" } },
      },
    },
  },
});
