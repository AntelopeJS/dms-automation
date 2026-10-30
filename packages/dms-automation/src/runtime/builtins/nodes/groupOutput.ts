import { type NodeExecute, nodeKinds } from "../../nodeKinds";

/**
 * Never invoked at runtime: flattenGroups strips groupOutput sentinels
 * and rewires outer edges straight to the inner producer nodes. The kind
 * stays registered so graph validation (nodeKindZodSchema) accepts it;
 * identity behavior kept for safety.
 */
const execute: NodeExecute = async (_node, inputs, ctx) => {
  ctx.setOutputs(inputs);
};

nodeKinds.register("groupOutput", execute, {
  continuationPorts: [],
  sidePorts: [],
});
