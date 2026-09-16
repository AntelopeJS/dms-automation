import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";
import { registry } from "../../registry";

async function execute(
  node: GraphNode,
  inputs: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<void> {
  const typeId = node.typeId;
  if (!typeId) {
    throw new Error(`action node "${node.id}" is missing typeId`);
  }
  const actionType = registry.getAction(typeId);
  if (!actionType) {
    throw new Error(
      `action node "${node.id}" references unknown type "${typeId}"`,
    );
  }
  const output = (await actionType.execute(inputs, ctx)) as
    | Record<string, unknown>
    | undefined;
  ctx.setOutputs(output ?? {});
}

nodeKinds.register("action", execute, {
  continuationPorts: ["main"],
  sidePorts: [],
  ui: {
    label: "Action",
    icon: "i-ph-gear",
    category: "action",
    hasTriggerIn: true,
    hasMainTriggerOut: true,
    staticTriggerOuts: [],
    staticDataIns: [],
    staticDataOuts: [],
    typeRegistry: "actions",
    dataInsFromTypeSchema: "inputSchema",
    dataOutsFromTypeSchema: "outputSchema",
    labelFromType: true,
    iconFromType: true,
  },
});
