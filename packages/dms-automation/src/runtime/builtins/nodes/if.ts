import { type NodeExecute, nodeKinds } from "../../nodeKinds";
import { toBoolean } from "../data/boolean";

/**
 * The chosen branch IS the continuation — outer walk auto-propagates
 * through it; the other branch is dead.
 */
const execute: NodeExecute = async (_node, inputs, ctx) => {
  const branch = toBoolean(inputs.cond) ? "then" : "else";
  ctx.log("info", `branch: ${branch}`);
  ctx.continueWith(branch);
};

nodeKinds.register("if", execute, {
  continuationPorts: [],
  sidePorts: ["then", "else"],
  ui: {
    label: "$dms_automation.nodes.kinds.if",
    icon: "i-ph-git-branch",
    category: "flow",
    hasTriggerIn: true,
    hasMainTriggerOut: false,
    staticTriggerOuts: ["then", "else"],
    staticDataIns: [{ name: "cond", type: "boolean" }],
    staticDataOuts: [],
  },
});
