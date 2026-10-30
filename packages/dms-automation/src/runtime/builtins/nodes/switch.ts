import { isString } from "../../../types/guards";
import { type NodeExecute, nodeKinds } from "../../nodeKinds";

const execute: NodeExecute = async (node, inputs, ctx) => {
  const cases = node.config.cases ?? [];
  const key = String(inputs.value);
  if (!isString(cases) && !Array.isArray(cases)) {
    throw new TypeError("switch cases must be a list");
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
