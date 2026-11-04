#!/usr/bin/env node
/**
 * Model-checks leader election and singleton trigger arming of
 * @antelopejs/dms-automation in redis mode with TLC through the shared runner
 * of @antelopejs/tooling-configs: LeaderTriggers.tla with every instance
 * running, then with one of them running destroy().
 *
 * With no argument it runs the CI configuration of each (`<config>.ci.cfg`);
 * with `--full` it runs the full one (`<config>.cfg`). Exits 0 when both
 * match the record in SKILL.md, 1 when a rule changed, and 2 when TLC could
 * not run. The runner exits on the first configuration that changed, so a
 * change in the running cluster skips the shutdown run.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpec, EXIT } from "@antelopejs/tooling-configs/formal";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** Rules the running cluster breaks, with the states in TLC's shortest counterexample. */
const RUNNING = { AtMostOneArmed: 12, ArmedImpliesBelief: 11 };

/** Rules a cluster where one instance runs destroy() breaks. */
const SHUTDOWN = { AtMostOneArmed: 12, ArmedImpliesBelief: 8, StopDisarms: 8 };

/** The findings of each configuration, in run order. */
const CONFIGS = {
  Running: { ci: RUNNING, full: RUNNING },
  Shutdown: { ci: SHUTDOWN, full: SHUTDOWN },
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
