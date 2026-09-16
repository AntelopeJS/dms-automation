// Same contract as the string nodes: see the note in
// runtime/builtins/data/string.ts.
/* oxlint-disable typescript/no-base-to-string */
import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

async function execute(
  node: GraphNode,
  _inputs: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<void> {
  const name = String(node.config.name ?? "");
  const value = node.config.value;
  ctx.setOutputs({ [name]: value });
}

nodeKinds.register("setVariable", execute, {
  continuationPorts: ["main"],
  sidePorts: [],
  ui: {
    label: "Set variable",
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
