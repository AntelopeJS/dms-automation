import { num, pick } from "../../auto.mjs";
import { action, chain, trigger } from "../../procs.mjs";
import { rowOf, runGraph, sinkState, stepsOfNode } from "./runtime-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

/**
 * Runs one HTTP request step on its own and reads how it ended.
 *
 * @param {Ctx} ctx The journey
 * @param {Row} config The settings of the HTTP request step
 * @returns {Promise<{ ran: import("./runtime-kit.mjs").Ran, step: Row | undefined, out: Row, error: string | null, warnings: string[] }>} The outcome
 */
export async function httpOnce(ctx, config) {
  const ran = await runGraph(ctx, chain([trigger("t"), action("h", "http.request", config)]));
  const step = stepsOfNode(ran, "h")[0];
  const out = rowOf(pick(step, "output", "value"));
  return {
    ran,
    step,
    out,
    error: ran.error,
    warnings: ran.entries.filter((entry) => entry.source === "log" && entry.level === "warn").map((entry) => String(entry.message)),
  };
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<string>} The base URL of the HTTP sink
 */
export async function sinkBase(ctx) {
  return (await sinkState(ctx)).base;
}

/**
 * A port nobody listens on: one a server just released.
 *
 * @returns {Promise<number>} The port
 */
export async function closedPort() {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = num(address, "port") ?? 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}
