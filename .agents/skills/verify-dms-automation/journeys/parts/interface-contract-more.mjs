import { auto, check, pick, same, text } from "../../auto.mjs";
import { createProcedure, runOf } from "../../procs.mjs";
import { actionNode, chainGraph, defineType, runProcedure, stepOf, triggerNode } from "./interface-calls.mjs";
import { strings } from "./package-shared.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

export const moreContractJourneys = [
  {
    id: "an-action-resolves-with-an-object-or-nothing-and-a-throw-fails-the-step",
    title: 'an action that resolves with anything but an object or nothing fails its step with `action type "<id>" must resolve with an object or nothing`; a throw of any value fails the step',
    entryPoint: "ActionType.execute results, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      /** @param {string} typeId @param {Row} [config] */
      const single = async (typeId, config = {}) => {
        const id = await createProcedure(ctx, {
          graph: chainGraph([triggerNode("t"), actionNode("a", typeId, config), actionNode("after", "log.message", { message: "after" })]),
        });
        const outcome = await runProcedure(ctx, id);
        return {
          outcome,
          run: await runOf(ctx, text(outcome.result, "runId")),
        };
      };
      const array = await single("verify.array-output");
      const string = await single("verify.string-output");
      const nothing = await single("verify.nothing");
      const fail = await single("verify.fail", { message: "boom é" });
      await ctx.verify("results", [
        same("an array fails the step", [array.outcome.result.status, array.outcome.result.errorMessage, stepOf(array.run, "a").status], ["failed", 'action type "verify.array-output" must resolve with an object or nothing', "failed"]),
        same("a string fails the step", [string.outcome.result.status, string.outcome.result.errorMessage], ["failed", 'action type "verify.string-output" must resolve with an object or nothing']),
        same("the step after a failure did not run", [Object.hasOwn(stepOf(array.run, "after"), "status"), Object.hasOwn(stepOf(fail.run, "after"), "status")], [false, false]),
        same("nothing is fine: the step has no outputs and the run goes on", [nothing.outcome.result.status, stepOf(nothing.run, "a").status, stepOf(nothing.run, "after").status], ["ok", "ok", "ok"]),
        same("an Error fails the step with its message", [fail.outcome.result.status, fail.outcome.result.errorMessage], ["failed", "boom é"]),
      ]);
      /** @type {import("../../auto.mjs").Check[]} */
      const throws = [];
      const expectations = {
        string: "plain string failure",
        number: "42",
        object: "[object Object]",
        null: "null",
        undefined: "undefined",
        array: "a,b",
      };
      for (const [kind, message] of Object.entries(expectations)) {
        const thrown = await single("verify.throw", { kind });
        throws.push(same(`a thrown ${kind} fails the step`, [thrown.outcome.result.status, thrown.outcome.result.errorMessage, stepOf(thrown.run, "a").status], ["failed", message, "failed"]));
      }
      const library = await auto(ctx, "switch the type off in the library", "PUT", "/action-types/verify.nothing/config", { body: { enabled: false } });
      const disabled = await single("verify.nothing");
      throws.push(same("the library switch answers", library.status, 200), same("a step whose action type is disabled in the library fails", [disabled.outcome.result.status, disabled.outcome.result.errorMessage], ["failed", 'action type "verify.nothing" is disabled in the library']));
      const empty = await single("verify.throw", { kind: "empty-string" });
      throws.push(same("a thrown empty string fails the step", [empty.outcome.result.status, stepOf(empty.run, "a").status], ["failed", "failed"]));
      await ctx.verify("thrown values that are not Errors", throws);
    },
  },
  {
    id: "a-data-node-evaluates-to-an-object-and-an-error-fails-the-step-that-reads-it",
    title: 'an evaluation error, or a result that is not an object or is an array, fails the step that reads the data node with `data node type "<id>" must evaluate to an object`',
    entryPoint: "DataNodeType.evaluate results, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      /** @param {string} typeId */
      const reading = async (typeId) => {
        const id = await createProcedure(ctx, {
          graph: {
            nodes: [
              triggerNode("t"),
              actionNode("reader", "verify.echo"),
              {
                id: "d",
                kind: "data",
                typeId,
                config: {},
                position: { x: 0, y: 100 },
              },
            ],
            triggerEdges: [{ id: "e", from: { node: "t" }, to: { node: "reader" } }],
            dataEdges: [
              {
                id: "de",
                from: { node: "d", port: "x" },
                to: { node: "reader", field: "value" },
              },
            ],
          },
        });
        const outcome = await runProcedure(ctx, id);
        return {
          outcome,
          run: await runOf(ctx, text(outcome.result, "runId")),
        };
      };
      const stamp = Date.now().toString(36);
      const text_ = `verify.text-result-${stamp}`;
      const nullish = `verify.null-result-${stamp}`;
      await defineType(ctx, {
        kind: "data",
        id: text_,
        name: "Text result",
        output: "just text",
      });
      await defineType(ctx, {
        kind: "data",
        id: nullish,
        name: "Null result",
        output: null,
      });
      const array = await reading("verify.bad-data");
      const thrown = await reading("verify.throwing-data");
      const string = await reading(text_);
      const empty = await reading(nullish);
      await ctx.verify("results", [
        same("an array", [array.outcome.result.status, array.outcome.result.errorMessage], ["failed", 'data node type "verify.bad-data" must evaluate to an object']),
        same("an error", [thrown.outcome.result.status, thrown.outcome.result.errorMessage], ["failed", "data node exploded"]),
        same("a string", [string.outcome.result.status, string.outcome.result.errorMessage], ["failed", `data node type "${text_}" must evaluate to an object`]),
        same("null", [empty.outcome.result.status, empty.outcome.result.errorMessage], ["failed", `data node type "${nullish}" must evaluate to an object`]),
        same("the step that reads it is the one that fails", [stepOf(array.run, "reader").status, pick(array.run, "failedStep") !== null], ["failed", true]),
      ]);
    },
  },
  {
    id: "the-execution-context-carries-the-ids-of-the-run-and-the-node",
    title: "ExecutionCtx holds procedureId, runId and nodeId, and dryRun reads false in a real run",
    entryPoint: "ExecutionCtx in execute, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, {
        graph: chainGraph([triggerNode("t"), actionNode("who-am-i é", "verify.context"), actionNode("again", "verify.context"), actionNode("shape", "verify.context-shape")]),
      });
      const outcome = await runProcedure(ctx, id);
      const run = await runOf(ctx, text(outcome.result, "runId"));
      const other = await runOf(ctx, text((await runProcedure(ctx, id)).result, "runId"));
      /** @param {Row} from @param {string} node */
      const output = (from, node) => pick(stepOf(from, node).output, "value");
      const runId = text(output(run, "who-am-i é"), "runId");
      await ctx.verify("the context", [
        same("first node: procedureId, nodeId and dryRun", [pick(output(run, "who-am-i é"), "procedureId"), pick(output(run, "who-am-i é"), "nodeId"), pick(output(run, "who-am-i é"), "dryRun")], [id, "who-am-i é", false]),
        same("second node: procedureId, nodeId and dryRun", [pick(output(run, "again"), "procedureId"), pick(output(run, "again"), "nodeId"), pick(output(run, "again"), "dryRun")], [id, "again", false]),
        check("runId is a non-empty string", runId.length > 0, runId),
        same("the context has no tenant and no user", [pick(output(run, "shape"), "hasTenant"), pick(output(run, "shape"), "hasUser")], [false, false]),
        same(
          "it holds the identifiers and the log function",
          ["log", "nodeId", "procedureId", "runId"].filter((key) => !strings(pick(output(run, "shape"), "keys")).includes(key)),
          [],
        ),
        same("both nodes of a run see one runId", text(output(run, "again"), "runId"), runId),
        check("another run has another runId", text(output(other, "again"), "runId") !== runId, [runId, text(output(other, "again"), "runId")]),
      ]);
    },
  },
];
