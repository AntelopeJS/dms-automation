import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

async function execute(
  node: GraphNode,
  _inputs: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<void> {
  ctx.setOutputs({ value: node.config.value });
}

nodeKinds.register("setVariable", execute, {
  continuationPorts: ["main"],
  sidePorts: [],
  ui: {
    label: "$dms_automation.nodes.kinds.setVariable",
    icon: "i-ph-database",
    category: "helper",
    hasTriggerIn: true,
    hasMainTriggerOut: true,
    staticTriggerOuts: [],
    staticDataIns: [],
    staticDataOuts: [{ name: "value" }],
    defaultConfig: { name: "var", value: null },
    configSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        value: {},
      },
    },
  },
});
