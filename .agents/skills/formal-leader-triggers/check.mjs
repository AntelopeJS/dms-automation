#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpec, EXIT } from "@antelopejs/tooling-configs/formal";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** Rules the running cluster breaks, with the states in TLC's shortest counterexample. */
const RUNNING = { AtMostOneArmed: 12, ArmedImpliesBelief: 11 };

/** Rules a cluster where one instance runs destroy() breaks. */
const SHUTDOWN = { AtMostOneArmed: 12, ArmedImpliesBelief: 11 };

/** Rules a shutdown breaks while no key expires, which leaves F1 out. */
const HANDOFF = {};

/** The findings of each configuration, in run order. */
const CONFIGS = {
  Running: { ci: RUNNING, full: RUNNING },
  Shutdown: { ci: SHUTDOWN, full: SHUTDOWN },
  Handoff: { ci: HANDOFF, full: HANDOFF },
};

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--full")) {
  console.error("usage: node check.mjs [--full]");
  process.exit(EXIT.tool);
}
const mode = args.includes("--full") ? "full" : "ci";

for (const [config, findings] of Object.entries(CONFIGS)) {
  await checkSpec({
    dir,
    spec: "LeaderTriggers",
    config: mode === "full" ? config : `${config}.ci`,
    findings: findings[mode],
  });
}
