import { guarded } from "../guard.mjs";
import { COMPARE_CASES, COMPARE_FAILURES, CONSTANT_CASES, LOGIC_CASES, MATH_CASES, MATH_FAILURES } from "./parts/data-cases-a.mjs";
import { JSON_CASES, OBJECT_CASES, TEXT_CASES } from "./parts/data-cases-b.mjs";
import { cycleChecks, customDataChecks, typeListChecks, wiringChecks } from "./parts/data-wiring.mjs";
import { DATA_ENTRIES, openLibrary, showEntries } from "./parts/runtime-library-wording.mjs";
import { evaluateCases, failureCase } from "./parts/runtime-kit.mjs";

/** @typedef {import("../auto.mjs").Ctx} Ctx */

/**
 * @param {Ctx} ctx The journey
 * @param {import("./parts/runtime-kit.mjs").DataCase[]} cases The cases
 * @param {{ type: string, config: Record<string, unknown>, message: string, label: string }[]} [failures] Cases that must fail
 * @returns {Promise<void>}
 */
async function drive(ctx, cases, failures = []) {
  const { checks } = await evaluateCases(ctx, cases);
  await ctx.verify("the values", checks);
  const failing = [];
  for (const one of failures) failing.push(...(await failureCase(ctx, one.label, one.type, one.config, one.message)));
  if (failing.length > 0) await ctx.verify("the failures", failing);
}

const ENTRY = "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id";

export const journeys = guarded([
  {
    id: "constants-emit-their-typed-value-or-the-default-of-their-type",
    title: "Text, Number, True or false and JSON constants emit the value typed into them, and the default of their type when saved without one: empty text, 0, false, null",
    entryPoint: ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await drive(ctx, CONSTANT_CASES);
    },
  },
  {
    id: "math-nodes-compute-and-fail-by-name",
    title: "Math nodes add, subtract, multiply, divide, take remainders, powers, min, max, sign, rounding and roots of numbers, written as text too; division by 0 gives an empty value, anything else that is not a number fails the step by name",
    entryPoint: ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await drive(ctx, MATH_CASES, MATH_FAILURES);
    },
  },
  {
    id: "comparison-nodes-compare-numbers-text-and-kinds",
    title: "Comparison nodes compare numbers written as text as numbers (5 equals 5, 10 is greater than 9), text alphabetically, and an empty value or a boolean only equals itself; number mode fails on a value that is not a number",
    entryPoint: ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await drive(ctx, COMPARE_CASES, COMPARE_FAILURES);
    },
  },
  {
    id: "logic-nodes-read-false-0-and-empty-text-as-false",
    title: "And, Or, Exactly one and Not read the texts false, 0 and empty text, whatever their case and spaces, as false",
    entryPoint: ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await drive(ctx, LOGIC_CASES);
    },
  },
  {
    id: "text-nodes-count-characters-as-a-reader-does",
    title: "Text nodes join, measure, cut, change the case of, trim, split, replace in and search text, counting an emoji or an accented letter as one character",
    entryPoint: ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await drive(ctx, TEXT_CASES);
    },
  },
  {
    id: "object-nodes-read-and-write-fields-by-path",
    title: "Object nodes read a field by a path like customer.email (an empty value when missing), set one on a copy, list field names and values, and merge two objects where b wins",
    entryPoint: ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await drive(ctx, OBJECT_CASES);
    },
  },
  {
    id: "json-nodes-read-and-write-json-text",
    title: "Read JSON turns JSON text into a value and gives an empty value when it is not valid; Write JSON turns a value into JSON text, pretty adding line breaks",
    entryPoint: ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await drive(ctx, JSON_CASES);
    },
  },
  {
    id: "data-edges-feed-fields-over-their-settings-and-defaults",
    title: "A field takes its schema default, then its setting, then the value wired from a data node, an action or the trigger payload; data nodes chain, and one read twice is computed once",
    entryPoint: ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("wiring", await wiringChecks(ctx));
    },
  },
  {
    id: "a-cycle-of-data-nodes-is-refused-naming-the-nodes",
    title: "Data nodes wired in a cycle are refused, the problem naming the nodes",
    entryPoint: ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("cycle", await cycleChecks(ctx));
    },
  },
  {
    id: "the-library-lists-every-built-in-data-node-with-its-ports",
    title: "The data node types are Constants, Math, Comparison, Logic, Text, Objects and JSON, each with the ports and settings the docs name",
    entryPoint: "GET /data-node-types",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("data node types", await typeListChecks(ctx));
    },
  },
  {
    id: "a-module-data-node-applies-defaults-merges-settings-and-must-return-an-object",
    title: "A data node from a module gets the default of its schema under its configured values, merges its settings into the evaluation, and fails the step that reads it when it throws or does not return an object",
    entryPoint: ENTRY + ", POST /verify-auto/types/unregister",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("module data nodes", await customDataChecks(ctx));
    },
  },
  {
    id: "the-library-words-each-data-node-as-the-docs-do",
    title: "The Library's Data nodes tab names each built-in data node and says in words what it does: 5 equals \"5\", an empty value when b is 0, an emoji counts as one, b wins in a merge",
    entryPoint: "/modules/automation/library?tab=dataNodes",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openLibrary(ctx, "dataNodes", /Built-in \u00b7 Comparison/);
      await ctx.verify("the entries", await showEntries(tab, DATA_ENTRIES));
    },
  },
]);
