import { type NodeExecute, nodeKinds } from "../../nodeKinds";

/**
 * Never invoked at runtime: flattenGroups strips groupInput sentinels
 * before execution. The kind stays registered so graph validation
 * (nodeKindZodSchema) accepts it; identity behavior kept for safety.
 */
const execute: NodeExecute = async (_node, inputs, ctx) => {
  ctx.setOutputs(inputs);
};

nodeKinds.register("groupInput", execute, {
  continuationPorts: [],
  sidePorts: [],
});
