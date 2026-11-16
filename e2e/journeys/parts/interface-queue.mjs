import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, parseJson, pick, same } from "../../auto.mjs";
import { QUEUE_SCRIPT } from "./interface-queue-script.mjs";
import { INTERFACE, read, repoOf } from "./package-files.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const CALLS = ["ListTriggerTypes", "ListActionTypes", "ListDataNodeTypes", "InvokeProcedure", "RunProcedure", "DeclareProcedure"];

/**
 * Loads the built interface in a plain Node process with no implementation attached and calls its functions.
 *
 * @param {Ctx} ctx The journey
 * @returns {unknown} What each call did
 */
function withoutImplementation(ctx) {
  const folder = ctx.step("the interface with no implementation");
  mkdirSync(folder, { recursive: true });
  const script = join(folder, "queue.cjs");
  writeFileSync(script, QUEUE_SCRIPT);
  const result = spawnSync(process.execPath, [script, join(repoOf(ctx), INTERFACE, "dist", "index.js")], { encoding: "utf8", timeout: 60_000 });
  writeFileSync(join(folder, "output.json"), result.stdout);
  return parseJson(result.stdout.trim());
}

export const queueJourneys = [
  {
    id: "interface-calls-wait-for-an-implementation-and-the-queue-holds-1000",
    title: "with no implementation loaded, the five calls and the List* functions stay pending; each queues at most 1,000 calls and the next rejects with ProviderQueueFullError; registering throws nothing",
    entryPoint: "the built @antelopejs/interface-dms-automation in a Node process without the module",
    async run(/** @type {Ctx} */ ctx) {
      const out = withoutImplementation(ctx);
      await ctx.verify("calls without an implementation", [
        ...CALLS.flatMap((name) => [same(`${name}: the first 1,000 calls stay pending`, [pick(out, "calls", name, "queued"), pick(out, "calls", name, "count")], [["pending"], 1000]), same(`${name}: the 1,001st call rejects`, pick(out, "calls", name, "next"), "rejected:ProviderQueueFullError")]),
        same("registering and unregistering a trigger, an action and a data node throw nothing", pick(out, "registerError"), null),
      ]);
    },
  },
  {
    id: "the-interface-skill-says-what-the-calls-do-without-an-implementation-as-the-readme-does",
    title: "the interface skill, the README, the consumer reference and the TSDoc agree on what List*, InvokeProcedure, RunProcedure and DeclareProcedure do with no implementation attached",
    entryPoint: "skills/dms-automation-interface/SKILL.md, README.md, docs/1.index.md against the built interface",
    async run(/** @type {Ctx} */ ctx) {
      const out = withoutImplementation(ctx);
      const observed = CALLS.every((name) => pick(out, "calls", name, "queued") && JSON.stringify(pick(out, "calls", name, "queued")) === '["pending"]') ? "wait" : "other";
      const skill = read(ctx, `${INTERFACE}/skills/dms-automation-interface/SKILL.md`);
      const readme = read(ctx, `${INTERFACE}/README.md`);
      const reference = read(ctx, `${INTERFACE}/docs/1.index.md`);
      /** @param {string} text */
      const claim = (text) => (/(returned promise stays pending|waits until one attaches|queue their call until an implementation attaches)/.test(text) ? "wait" : /reject[^.]*without an implementation|reject when no implementation/.test(text) ? "reject" : "silent");
      await ctx.verify("what the calls do", [
        same("observed with the built interface", observed, "wait"),
        same("the README says they wait", claim(readme), "wait"),
        same("the consumer reference says they wait", claim(reference), "wait"),
        same("the interface skill says they wait", claim(skill), "wait"),
        check("the skill does not tell consumers to wrap the calls in try/catch to branch on availability", !/wrap in try\/catch to branch on availability/.test(skill), "skill"),
      ]);
    },
  },
];
