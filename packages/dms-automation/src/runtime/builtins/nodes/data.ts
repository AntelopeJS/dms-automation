import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

async function execute(
  node: GraphNode,
  _inputs: Record<string, unknown>,
  _ctx: NodeCtx,
): Promise<void> {
  // Data nodes are pulled lazily by `resolveInputs` — `runSubWalk` skips
  // them in the trigger walk. This function only exists to register the
  // kind so its UI metadata is served via `/api/automation/node-kinds`.
  throw new Error(
    `executeData unexpectedly invoked for node "${node.id}"; ` +
      "data nodes evaluate via resolveInputs, not the trigger walk",
  );
}

nodeKinds.register("data", execute, {
  continuationPorts: [],
  sidePorts: [],
  ui: {
    label: "Data",
    icon: "i-ph-function",
    category: "data",
    hasTriggerIn: false,
    hasMainTriggerOut: false,
    staticTriggerOuts: [],
    staticDataIns: [],
    staticDataOuts: [],
    typeRegistry: "dataNodes",
    dataInsFromTypeSchema: "inputSchema",
    dataOutsFromTypeSchema: "outputSchema",
    labelFromType: true,
    iconFromType: true,
    categoryFromType: true,
  },
});
