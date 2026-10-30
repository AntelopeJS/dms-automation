import { type NodeExecute, nodeKinds } from "../../nodeKinds";

const execute: NodeExecute = async (node, inputs, ctx) => {
  const ms = Number(node.config.ms ?? 0);
  if (ms > 0) {
    await new Promise<void>((resolve, reject) => {
      if (ctx.signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const t = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      };
      ctx.signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  ctx.setOutputs(inputs);
};

nodeKinds.register("delay", execute, {
  continuationPorts: ["main"],
  sidePorts: [],
  ui: {
    label: "$dms_automation.nodes.kinds.delay",
    icon: "i-ph-clock",
    category: "helper",
    hasTriggerIn: true,
    hasMainTriggerOut: true,
    staticTriggerOuts: [],
    staticDataIns: [],
    staticDataOuts: [],
    defaultConfig: { ms: 1000 },
    configSchema: {
      type: "object",
      properties: { ms: { type: "number", title: "Delay (ms)", minimum: 0 } },
    },
  },
});
