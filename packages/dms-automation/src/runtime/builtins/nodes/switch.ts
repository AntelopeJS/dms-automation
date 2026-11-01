import { isString } from "../../../types/guards";
import { type NodeExecute, nodeKinds } from "../../nodeKinds";

/**
 * Takes the branch named after the value's text, `String(value)`, whatever the
 * value: an object reads `[object Object]`, an array its items joined by
 * commas. The switch reads its inputs as unknown values for that reason.
 */
const execute: NodeExecute = async (
  node,
  inputs: Record<string, unknown>,
  ctx,
) => {
  const cases = node.config.cases ?? [];
  const key = String(inputs.value);
  if (!isString(cases) && !Array.isArray(cases)) {
    throw new TypeError("cases.includes is not a function");
  }
  const branch = cases.includes(key) ? key : "default";
  ctx.log("info", `branch: ${branch}`);
  ctx.continueWith(branch);
};

nodeKinds.register("switch", execute, {
  continuationPorts: [],
  sidePorts: [],
  ui: {
    label: "$dms_automation.nodes.kinds.switch",
    icon: "i-ph-share-network",
    category: "flow",
    hasTriggerIn: true,
    hasMainTriggerOut: false,
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
