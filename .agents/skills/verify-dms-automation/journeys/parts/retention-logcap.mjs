import { check, same, text } from "../../auto.mjs";
import { action, chain, trigger } from "../../procs.mjs";
import { runGraph } from "./runtime-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const CAP = 2000;
const BASE_ENTRIES = 2;
const LOG_STEP_ENTRIES = 3;
const LEVELS_STEP_ENTRIES = 5;

/**
 * A run of `logSteps` Log steps and `levelSteps` log-levels steps. A run holds 2 entries of its own, a Log step adds 3 and a
 * log-levels step 5 (it logs once at each level), so the counts below give a run of exactly the wanted size.
 *
 * @param {Ctx} ctx The journey
 * @param {number} logSteps How many Log steps
 * @param {number} levelSteps How many log-levels steps
 * @returns {Promise<import("./runtime-kit.mjs").Ran>} The run
 */
function runOfSize(ctx, logSteps, levelSteps) {
  const steps = [
    ...Array.from({ length: logSteps }, (_, index) => action(`l${index}`, "log.message", { message: "m" })),
    ...Array.from({ length: levelSteps }, (_, index) => action(`v${index}`, "verify.log-levels", { message: "m" })),
  ];
  return runGraph(ctx, chain([trigger("t"), ...steps]));
}

export const logCapJourneys = [
  {
    id: "a-run-log-over-2000-entries-keeps-2000-with-a-truncation-notice",
    title: "a run whose log holds exactly 2000 entries is stored whole; one entry more is stored as 2000 entries, the last a warning that says 2 entries were dropped",
    entryPoint: "GET /runs/:id/logs, a chain of Log steps",
    async run(/** @type {Ctx} */ ctx) {
      const exact = await runOfSize(ctx, (CAP - BASE_ENTRIES) / LOG_STEP_ENTRIES, 0);
      const over = await runOfSize(ctx, (CAP + 1 - BASE_ENTRIES - 2 * LEVELS_STEP_ENTRIES) / LOG_STEP_ENTRIES, 2);
      const last = over.entries[over.entries.length - 1];
      await ctx.verify("the entry cap", [
        same("2000 entries are kept whole", exact.entries.length, CAP),
        check("and none of them is a truncation notice", exact.entries.every((entry) => !text(entry, "message").startsWith("log truncated")), exact.entries.length),
        same("2001 entries are stored as 2000", over.entries.length, CAP),
        check("the last is the warning that 2 entries were dropped", text(last, "level") === "warn" && text(last, "message") === "log truncated: 2 entries dropped", JSON.stringify(last)),
        same("the run still ended ok", over.status, "ok"),
      ]);
    },
  },
];
