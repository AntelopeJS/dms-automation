/**
 * A CommonJS program that loads the built interface (its path is the first argument), calls its functions with no implementation attached, and prints what each call did as JSON. The journey writes it into its evidence folder and runs it with node.
 */
export const QUEUE_SCRIPT = String.raw`const interfaceModule = require(process.argv[2]);
const CALLS = ["ListTriggerTypes", "ListActionTypes", "ListDataNodeTypes", "InvokeProcedure", "RunProcedure", "DeclareProcedure"];
const WAIT_MS = 300;

async function settle(call) {
  const promise = call();
  return Promise.race([
    promise.then(
      () => "resolved",
      (error) => "rejected:" + (error && error.constructor ? error.constructor.name : typeof error),
    ),
    new Promise((resolve) => setTimeout(() => resolve("pending"), WAIT_MS)),
  ]);
}

async function main() {
  const out = {};
  for (const name of CALLS) {
    const first = [];
    for (let index = 0; index < 1000; index += 1) first.push(settle(() => interfaceModule[name]("x", {})));
    const next = await settle(() => interfaceModule[name]("x", {}));
    const queued = await Promise.all(first);
    out[name] = { queued: [...new Set(queued)], count: queued.length, next };
  }
  let registerError = null;
  try {
    interfaceModule.RegisterActionType({ id: "a.b", name: "n", description: "d", icon: "i", inputSchema: {}, outputSchema: {}, execute: async () => ({}) });
    interfaceModule.RegisterTriggerType({ id: "a.t", name: "n", description: "d", icon: "i", configSchema: {}, outputSchema: {}, cluster: "singleton", activate: async () => null, deactivate: async () => {} });
    interfaceModule.RegisterDataNodeType({ id: "a.d", name: "n", description: "d", icon: "i", category: "c", inputSchema: {}, outputSchema: {}, evaluate: () => ({}) });
    interfaceModule.UnregisterActionType("a.b");
    interfaceModule.UnregisterTriggerType("a.t");
    interfaceModule.UnregisterDataNodeType("a.d");
  } catch (error) {
    registerError = String(error);
  }
  process.stdout.write(JSON.stringify({ calls: out, registerError }) + "\n");
  process.exit(0);
}

main();
`;
