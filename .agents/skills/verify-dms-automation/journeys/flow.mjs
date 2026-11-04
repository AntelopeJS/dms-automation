import { guarded } from "../guard.mjs";
import { FLOW_ENTRIES, openLibrary, showEntries } from "./parts/runtime-library-wording.mjs";
import { composeChecks, failureStopsChecks, loopDataChecks } from "./parts/flow-compose.mjs";
import { delayChecks, kindChecks, variableChecks } from "./parts/flow-helpers.mjs";
import { parallelChecks, retryChecks, tryCatchChecks } from "./parts/flow-recovery.mjs";
import { foreachChecks, rangeChecks, rangeLimitChecks } from "./parts/flow-loops.mjs";
import { ifChecks, ifRun, switchChecks, switchRun, switchWiredAndEmpty } from "./parts/flow-branching.mjs";

/** @typedef {import("../auto.mjs").Ctx} Ctx */

export const journeys = guarded([
  {
    id: "if-follows-then-when-the-condition-is-true-and-else-otherwise",
    title: "If follows then when its condition is true and else otherwise; the texts false, 0 and empty text read as false, like false, 0 and null",
    entryPoint: "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id, GET /runs/:id/logs",
    async run(/** @type {Ctx} */ ctx) {
      const ran = await ifRun(ctx);
      await ctx.verify("every If takes the documented branch", ifChecks(ran));
    },
  },
  {
    id: "switch-follows-the-case-matching-the-value-or-default",
    title: "Switch follows the branch whose case matches the value, or default; numbers and booleans match by their text, objects and lists by their JSON text",
    entryPoint: "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      const ran = await switchRun(ctx);
      await ctx.verify("every Switch takes the documented branch", switchChecks(ran));
      await ctx.verify("a wired value and a Switch without cases", await switchWiredAndEmpty(ctx));
    },
  },
  {
    id: "for-each-runs-its-body-once-per-item-of-a-list-in-order",
    title: "For each runs its body once per item of a list, in order, with the item as value and its position as index; an input that is not a list iterates zero times with a warning",
    entryPoint: "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("For each", await foreachChecks(ctx));
    },
  },
  {
    id: "for-range-runs-its-body-for-each-number-of-a-range",
    title: "For range runs its body for each number from start up to end (not included) by step; start defaults to 0 and step to 1, a step of 0 fails, the loop is capped at 10000 iterations",
    entryPoint: "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("For range", await rangeChecks(ctx));
      await ctx.verify("For range iteration limit", await rangeLimitChecks(ctx));
    },
  },
  {
    id: "parallel-starts-every-branch-at-once-and-waits-for-all-of-them",
    title: "Parallel starts every branch at once and waits for all of them; a failing branch fails the parallel only after the others ended, with the first failure",
    entryPoint: "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id, fixture ledger",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("Parallel", await parallelChecks(ctx));
    },
  },
  {
    id: "try-catch-runs-catch-with-the-error-when-try-fails",
    title: "Try / Catch runs try, and catch with the error and its name if it fails, then main; errors thrown as non-Error values read as their text",
    entryPoint: "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id, fixture ledger",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("Try / Catch", await tryCatchChecks(ctx));
    },
  },
  {
    id: "retry-runs-its-body-up-to-max-attempts-then-goes-on-from-exhausted",
    title: "Retry runs its body up to Max attempts times (3 by default, at least 1); when every attempt fails the flow goes on from exhausted, otherwise from main",
    entryPoint: "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id, fixture ledger",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("Retry", await retryChecks(ctx));
    },
  },
  {
    id: "delay-waits-the-set-time-then-the-flow-goes-on",
    title: "Delay waits a set time, in milliseconds, then the next step runs; a delay of 0 or less does not wait",
    entryPoint: "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id, fixture ledger",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("Delay", await delayChecks(ctx));
    },
  },
  {
    id: "set-variable-names-a-value-for-the-next-steps",
    title: "Set variable names a value, of any JSON type, and the next steps read it from its value output",
    entryPoint: "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("Set variable", await variableChecks(ctx));
    },
  },
  {
    id: "the-flow-nodes-publish-the-ports-the-builder-table-names",
    title: "The Flow group holds If, Switch, For each, For range, Parallel, Try / Catch and Retry; the Helpers group holds Delay and Set variable; each publishes the branches the table names",
    entryPoint: "GET /node-kinds",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("node kinds", await kindChecks(ctx));
    },
  },
  {
    id: "flow-nodes-nest-and-a-failing-step-stops-the-run",
    title: "Flow nodes nest (a loop inside a Try / Catch, an If inside the loop); a step that fails stops the run, which names the failed node and keeps the error",
    entryPoint: "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("nesting", await composeChecks(ctx));
      await ctx.verify("a failing step", await failureStopsChecks(ctx));
    },
  },
  {
    id: "a-data-node-wired-from-a-loop-is-computed-for-every-iteration",
    title: "A data node wired from the value of a For each computes from the item of each iteration, not from the first one",
    entryPoint: "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("data in a loop", await loopDataChecks(ctx));
    },
  },
  {
    id: "the-library-lists-flow-and-helpers-with-their-wording",
    title: "The Library's Flow & helpers tab lists If, Switch, For each, For range, Parallel, Try / Catch and Retry under Flow and Delay and Set variable under Helpers, each with its description",
    entryPoint: "/modules/automation/library?tab=flow",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openLibrary(ctx, "flow", /Helpers/i);
      await ctx.verify("the entries", await showEntries(tab, FLOW_ENTRIES));
      await ctx.verify("the groups", [await tab.shows(/Flow\s+For range[\s\S]*Helpers\s+Delay/i, { timeoutMs: 4000 })]);
    },
  },
]);
