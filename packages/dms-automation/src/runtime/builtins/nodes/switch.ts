import { isObject, isString } from "../../../types/guards";
import { type NodeExecute, nodeKinds } from "../../nodeKinds";

/**
 * Takes the branch named after the value's text: a string as is, a number or
 * a boolean as `String(value)` writes it, an object or an array as its JSON
 * text.
 */
const execute: NodeExecute = async (node, inputs, ctx) => {
  const cases = node.config.cases ?? [];
  const value = inputs.value;
  const key = isObject(value) ? JSON.stringify(value) : String(value);
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
