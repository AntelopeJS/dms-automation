import { type NodeExecute, nodeKinds } from "../../nodeKinds";

/**
 * Data nodes are pulled lazily by `resolveInputs` — `runSubWalk` skips
 * them in the trigger walk. This function only exists to register the
 * kind so its UI metadata is served via `/api/automation/node-kinds`.
 */
const execute: NodeExecute = async (node) => {
  throw new Error(
    `executeData unexpectedly invoked for node "${node.id}"; ` +
      "data nodes evaluate via resolveInputs, not the trigger walk",
  );
};

nodeKinds.register("data", execute, {
  continuationPorts: [],
  sidePorts: [],
  ui: {
    label: "$dms_automation.nodes.kinds.data",
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
